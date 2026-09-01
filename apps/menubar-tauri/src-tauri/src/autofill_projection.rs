use crate::autofill_contract::{AgentErrorCode, AgentOperation, AgentRequest};
use crate::autofill_ipc::AgentClient;
use crate::autofill_reprompt::AutoFillRepromptReceiptStore;
use crate::session_broker::{AuthorizationState, ProjectionSessionContext, SessionBroker};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::ffi::{CStr, CString};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use zeroize::{Zeroize, Zeroizing};

const MAGIC: &[u8; 8] = b"BWAFPRJ1";
const FORMAT_VERSION: u16 = 1;
const NONCE_BYTES: usize = 12;
const KEY_BYTES: usize = 32;
const HEADER_BYTES: usize = MAGIC.len() + 2 + NONCE_BYTES;
const MAX_PROJECTION_ENVELOPE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Zeroize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoFillUri {
    pub uri: String,
    pub match_type: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Zeroize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoFillLogin {
    pub cipher_id: String,
    pub name: String,
    #[serde(default)]
    pub notes: Option<String>,
    pub username: String,
    pub password: String,
    pub uris: Vec<AutoFillUri>,
    pub totp: String,
    pub favorite: bool,
    pub reprompt: bool,
    #[serde(default)]
    pub last_used_at: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Zeroize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoFillBinding {
    pub bundle_id: String,
    pub cipher_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Zeroize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoFillHistory {
    pub context_key: String,
    pub cipher_id: String,
    pub successful_selection_count: u32,
    pub last_selected_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Zeroize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoFillProjectionInput {
    pub account_id: String,
    pub created_at: String,
    pub logins: Vec<AutoFillLogin>,
    pub bindings: Vec<AutoFillBinding>,
    pub history: Vec<AutoFillHistory>,
}

impl Drop for AutoFillProjectionInput {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Zeroize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoFillProjection {
    pub version: u16,
    pub account_id: String,
    pub vault_revision: u64,
    pub created_at: String,
    pub logins: Vec<AutoFillLogin>,
    pub bindings: Vec<AutoFillBinding>,
    pub history: Vec<AutoFillHistory>,
}

impl AutoFillProjection {
    fn take_from_input(input: &mut AutoFillProjectionInput, vault_revision: u64) -> Self {
        Self {
            version: FORMAT_VERSION,
            account_id: std::mem::take(&mut input.account_id),
            vault_revision,
            created_at: std::mem::take(&mut input.created_at),
            logins: std::mem::take(&mut input.logins),
            bindings: std::mem::take(&mut input.bindings),
            history: std::mem::take(&mut input.history),
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct ProjectionProvision {
    pub generation: String,
    pub account_id: String,
    pub vault_revision: u64,
    pub key: Vec<u8>,
    pub lease_duration_seconds: u64,
    pub projection_path: PathBuf,
}

impl Drop for ProjectionProvision {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

pub trait ProjectionAgent: Send + Sync {
    fn provision(&self, provision: ProjectionProvision) -> Result<(), ProjectionError>;
    fn lock(&self) -> Result<(), ProjectionError>;
    fn renew(
        &self,
        generation: &str,
        account_id: &str,
        lease_seconds: u64,
    ) -> Result<(), ProjectionError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProjectionError {
    InvalidInput,
    StaleRevision,
    CorruptProjection,
    AgentUnavailable,
    Interrupted,
    Io,
    StaleBinding,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectionReceipt {
    pub path: PathBuf,
    pub generation: String,
    pub vault_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectionOwner {
    process_generation: String,
    ownership_epoch: u64,
    account_id: String,
}

impl ProjectionOwner {
    fn from_context(context: &ProjectionSessionContext) -> Result<Self, ProjectionError> {
        if context.authorization != AuthorizationState::Unlocked {
            return Err(ProjectionError::StaleBinding);
        }
        let account_id = context
            .active_account_id
            .clone()
            .ok_or(ProjectionError::StaleBinding)?;
        Ok(Self {
            process_generation: context.process_generation.clone(),
            ownership_epoch: context.ownership_epoch,
            account_id,
        })
    }

    #[cfg(test)]
    fn unlocked(process_generation: &str, ownership_epoch: u64, account_id: &str) -> Self {
        Self {
            process_generation: process_generation.to_owned(),
            ownership_epoch,
            account_id: account_id.to_owned(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionBindingReceipt {
    pub token: String,
    pub account_id: String,
}

struct ProjectionBinding {
    token: String,
    process_generation: String,
    account_id: String,
    captured_ownership_epoch: u64,
}

#[derive(Default)]
struct ProjectionAuthority {
    binding: Option<ProjectionBinding>,
    invalidated_at: Option<(String, u64)>,
}

struct ProjectionState {
    account_id: String,
    generation: String,
    vault_revision: u64,
    key: [u8; KEY_BYTES],
    path: PathBuf,
}

#[derive(Default)]
struct RecoveryLedger {
    artifacts: Vec<String>,
    agent_lock_required: bool,
    directory_sync_required: bool,
}

impl RecoveryLedger {
    fn remember(&mut self, name: impl Into<String>) {
        let name = name.into();
        if is_projection_artifact(&name) && !self.artifacts.contains(&name) {
            self.artifacts.push(name);
        }
    }
}

struct SecureDirectory {
    requested_root: PathBuf,
    root: PathBuf,
    directory: File,
}

impl SecureDirectory {
    fn open(root: &Path) -> Result<Self, ProjectionError> {
        let existed = root.exists();
        if !existed {
            fs::create_dir_all(root).map_err(|_| ProjectionError::Io)?;
            fs::set_permissions(root, fs::Permissions::from_mode(0o700))
                .map_err(|_| ProjectionError::Io)?;
        }
        let metadata = fs::symlink_metadata(root).map_err(|_| ProjectionError::Io)?;
        if metadata.file_type().is_symlink()
            || !metadata.is_dir()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o777 != 0o700
        {
            return Err(ProjectionError::Io);
        }
        let path = CString::new(root.as_os_str().as_bytes()).map_err(|_| ProjectionError::Io)?;
        let fd = unsafe {
            libc::open(
                path.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(ProjectionError::Io);
        }
        let directory = unsafe { File::from_raw_fd(fd) };
        let opened_metadata = directory.metadata().map_err(|_| ProjectionError::Io)?;
        if opened_metadata.dev() != metadata.dev() || opened_metadata.ino() != metadata.ino() {
            return Err(ProjectionError::Io);
        }
        let canonical = root.canonicalize().map_err(|_| ProjectionError::Io)?;
        let result = Self {
            requested_root: root.to_path_buf(),
            root: canonical,
            directory,
        };
        result.validate_directory()?;
        Ok(result)
    }

    fn validate_directory(&self) -> Result<(), ProjectionError> {
        let metadata = self.directory.metadata().map_err(|_| ProjectionError::Io)?;
        if !secure_directory_metadata(&metadata, unsafe { libc::geteuid() }) {
            return Err(ProjectionError::Io);
        }
        Ok(())
    }

    fn validate_path_binding(&self) -> Result<(), ProjectionError> {
        let fd_metadata = self.directory.metadata().map_err(|_| ProjectionError::Io)?;
        for path in [&self.requested_root, &self.root] {
            let path_metadata = fs::symlink_metadata(path).map_err(|_| ProjectionError::Io)?;
            if path_metadata.file_type().is_symlink()
                || !secure_directory_metadata(&path_metadata, unsafe { libc::geteuid() })
                || path_metadata.dev() != fd_metadata.dev()
                || path_metadata.ino() != fd_metadata.ino()
            {
                return Err(ProjectionError::Io);
            }
        }
        Ok(())
    }

    fn name(name: &str) -> Result<CString, ProjectionError> {
        if name.is_empty() || name.contains('/') || name == "." || name == ".." {
            return Err(ProjectionError::Io);
        }
        CString::new(name).map_err(|_| ProjectionError::Io)
    }

    fn create_file(&self, name: &str) -> Result<File, ProjectionError> {
        let name = Self::name(name)?;
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err(ProjectionError::Io);
        }
        let file = unsafe { File::from_raw_fd(fd) };
        let metadata = match file.metadata() {
            Ok(metadata) => metadata,
            Err(_) => {
                drop(file);
                let _ = unsafe { libc::unlinkat(self.directory.as_raw_fd(), name.as_ptr(), 0) };
                return Err(ProjectionError::Io);
            }
        };
        if !Self::valid_file_metadata(&metadata) {
            drop(file);
            let _ = unsafe { libc::unlinkat(self.directory.as_raw_fd(), name.as_ptr(), 0) };
            return Err(ProjectionError::Io);
        }
        Ok(file)
    }

    fn read_file(&self, name: &str) -> Result<Vec<u8>, ProjectionError> {
        self.validate_path_binding()?;
        let name = Self::name(name)?;
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(ProjectionError::Io);
        }
        let mut file = unsafe { File::from_raw_fd(fd) };
        let metadata = file.metadata().map_err(|_| ProjectionError::Io)?;
        if !Self::valid_file_metadata(&metadata)
            || metadata.len() > MAX_PROJECTION_ENVELOPE_BYTES as u64
        {
            return Err(ProjectionError::Io);
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        Read::by_ref(&mut file)
            .take((MAX_PROJECTION_ENVELOPE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| ProjectionError::Io)?;
        if bytes.len() > MAX_PROJECTION_ENVELOPE_BYTES {
            bytes.zeroize();
            return Err(ProjectionError::Io);
        }
        self.validate_path_binding()?;
        Ok(bytes)
    }

    fn validate_existing_file(&self, name: &str) -> Result<bool, ProjectionError> {
        let name = Self::name(name)?;
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        let result = unsafe {
            libc::fstatat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result < 0 {
            if std::io::Error::last_os_error().raw_os_error() == Some(libc::ENOENT) {
                return Ok(false);
            }
            return Err(ProjectionError::Io);
        }
        let stat = unsafe { stat.assume_init() };
        if !secure_file_stat(stat.st_mode, stat.st_uid, stat.st_nlink, unsafe {
            libc::geteuid()
        }) {
            return Err(ProjectionError::Io);
        }
        Ok(true)
    }

    fn valid_file_metadata(metadata: &fs::Metadata) -> bool {
        metadata.is_file()
            && metadata.uid() == unsafe { libc::geteuid() }
            && metadata.mode() & 0o777 == 0o600
            && metadata.nlink() == 1
    }

    fn rename(&self, old: &str, new: &str) -> Result<(), ProjectionError> {
        let old = Self::name(old)?;
        let new = Self::name(new)?;
        let result = unsafe {
            libc::renameat(
                self.directory.as_raw_fd(),
                old.as_ptr(),
                self.directory.as_raw_fd(),
                new.as_ptr(),
            )
        };
        if result < 0 {
            return Err(ProjectionError::Io);
        }
        Ok(())
    }

    fn remove(&self, name: &str) -> Result<bool, ProjectionError> {
        if !self.validate_existing_file(name)? {
            return Ok(false);
        }
        let name = Self::name(name)?;
        if unsafe { libc::unlinkat(self.directory.as_raw_fd(), name.as_ptr(), 0) } < 0 {
            return Err(ProjectionError::Io);
        }
        Ok(true)
    }

    fn sync(&self) -> Result<(), ProjectionError> {
        self.directory.sync_all().map_err(|_| ProjectionError::Io)
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    fn artifact_names(&self) -> Result<Vec<String>, ProjectionError> {
        let current_directory = c".";
        let scan_fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                current_directory.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if scan_fd < 0 {
            return Err(ProjectionError::Io);
        }
        let stream = unsafe { libc::fdopendir(scan_fd) };
        if stream.is_null() {
            unsafe { libc::close(scan_fd) };
            return Err(ProjectionError::Io);
        }
        let mut names = Vec::new();
        loop {
            unsafe { *libc::__error() = 0 };
            let entry = unsafe { libc::readdir(stream) };
            if entry.is_null() {
                let failed = std::io::Error::last_os_error().raw_os_error().unwrap_or(0) != 0;
                unsafe { libc::closedir(stream) };
                return if failed {
                    Err(ProjectionError::Io)
                } else {
                    Ok(names)
                };
            }
            let bytes = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
            let Ok(name) = std::str::from_utf8(bytes) else {
                continue;
            };
            if is_projection_artifact(name) {
                names.push(name.to_owned());
            }
        }
    }
}

fn is_projection_artifact(name: &str) -> bool {
    if let Some(digest) = name
        .strip_prefix("projection-")
        .and_then(|value| value.strip_suffix(".bwaf"))
    {
        return digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit());
    }
    for suffix in [".tmp", ".bak"] {
        if let Some(identifier) = name
            .strip_prefix(".projection-")
            .and_then(|value| value.strip_suffix(suffix))
        {
            return identifier.len() == 36
                && identifier
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() || byte == b'-');
        }
    }
    false
}

fn secure_directory_metadata(metadata: &fs::Metadata, effective_uid: u32) -> bool {
    metadata.is_dir() && metadata.uid() == effective_uid && metadata.mode() & 0o777 == 0o700
}

fn secure_file_stat(
    mode: libc::mode_t,
    uid: libc::uid_t,
    nlink: libc::nlink_t,
    effective_uid: u32,
) -> bool {
    mode & libc::S_IFMT == libc::S_IFREG
        && uid == effective_uid
        && mode & 0o777 == 0o600
        && nlink == 1
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReplaceStage {
    AfterTempSync,
    AfterBackupRename,
    AfterFinalRename,
    BeforeCleanupRemove,
    BeforeCleanupDirectorySync,
    DuringRollback,
    BeforeTempCleanupRemove,
    BeforeTempCleanupDirectorySync,
    BeforeProvisionRollback,
    BeforeClearRemove,
    BeforeClearDirectorySync,
    BeforeLockRemove,
    BeforeLockDirectorySync,
}

#[cfg(not(test))]
#[derive(Clone, Copy)]
enum ReplaceStage {
    AfterTempSync,
    AfterBackupRename,
    AfterFinalRename,
    BeforeCleanupRemove,
    BeforeCleanupDirectorySync,
    DuringRollback,
    BeforeTempCleanupRemove,
    BeforeTempCleanupDirectorySync,
    BeforeProvisionRollback,
    BeforeClearRemove,
    BeforeClearDirectorySync,
    BeforeLockRemove,
    BeforeLockDirectorySync,
}

fn rollback_replacement(
    directory: &SecureDirectory,
    final_name: &str,
    backup_name: &str,
    had_final: bool,
    stage_hook: &mut impl FnMut(ReplaceStage) -> Result<(), ProjectionError>,
) -> Result<(), ProjectionError> {
    stage_hook(ReplaceStage::DuringRollback)?;
    directory.remove(final_name)?;
    if had_final {
        directory.rename(backup_name, final_name)?;
    }
    directory.sync()
}

impl Drop for ProjectionState {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

pub struct ProjectionManager<A: ProjectionAgent> {
    root: PathBuf,
    agent: std::sync::Arc<A>,
    state: Mutex<Option<ProjectionState>>,
    pending_lock: AtomicBool,
    pending_cleanup: Mutex<Vec<PathBuf>>,
    pending_directory_sync: AtomicBool,
    authority: Mutex<ProjectionAuthority>,
    recovery: Mutex<Option<RecoveryLedger>>,
}

impl<A: ProjectionAgent> ProjectionManager<A> {
    pub fn new(root: PathBuf, agent: std::sync::Arc<A>) -> Self {
        Self {
            root,
            agent,
            state: Mutex::new(None),
            pending_lock: AtomicBool::new(false),
            pending_cleanup: Mutex::new(Vec::new()),
            pending_directory_sync: AtomicBool::new(false),
            authority: Mutex::new(ProjectionAuthority::default()),
            recovery: Mutex::new(None),
        }
    }

    pub fn capture_binding(
        &self,
        account_id: &str,
        owner: &ProjectionOwner,
    ) -> Result<ProjectionBindingReceipt, ProjectionError> {
        if account_id.is_empty() || owner.account_id != account_id {
            return Err(ProjectionError::StaleBinding);
        }
        let mut authority = self.authority.lock().map_err(|_| ProjectionError::Io)?;
        if authority
            .invalidated_at
            .as_ref()
            .is_some_and(|(generation, version)| {
                generation == &owner.process_generation && owner.ownership_epoch <= *version
            })
        {
            return Err(ProjectionError::StaleBinding);
        }
        if let Some(binding) = authority.binding.as_ref() {
            if binding.process_generation != owner.process_generation
                || binding.account_id != owner.account_id
                || binding.captured_ownership_epoch != owner.ownership_epoch
            {
                return Err(ProjectionError::StaleBinding);
            }
            return Ok(ProjectionBindingReceipt {
                token: binding.token.clone(),
                account_id: binding.account_id.clone(),
            });
        }
        let binding = ProjectionBinding {
            token: uuid::Uuid::new_v4().to_string(),
            process_generation: owner.process_generation.clone(),
            account_id: owner.account_id.clone(),
            captured_ownership_epoch: owner.ownership_epoch,
        };
        let receipt = ProjectionBindingReceipt {
            token: binding.token.clone(),
            account_id: binding.account_id.clone(),
        };
        authority.binding = Some(binding);
        Ok(receipt)
    }

    pub fn replace_bound(
        &self,
        input: AutoFillProjectionInput,
        binding_token: &str,
        owner: &ProjectionOwner,
    ) -> Result<ProjectionReceipt, ProjectionError> {
        let authority = self.authority.lock().map_err(|_| ProjectionError::Io)?;
        let binding = authority
            .binding
            .as_ref()
            .ok_or(ProjectionError::StaleBinding)?;
        if binding.token != binding_token
            || binding.account_id != input.account_id
            || binding.account_id != owner.account_id
            || binding.process_generation != owner.process_generation
            || owner.ownership_epoch != binding.captured_ownership_epoch
        {
            return Err(ProjectionError::StaleBinding);
        }
        self.replace_with_hook(input, |_| Ok(()))
    }

    pub fn invalidate_and_lock(&self, owner: &ProjectionOwner) -> Result<(), ProjectionError> {
        let mut authority = self.authority.lock().map_err(|_| ProjectionError::Io)?;
        authority.binding = None;
        authority.invalidated_at = Some((owner.process_generation.clone(), owner.ownership_epoch));
        self.lock()
    }

    pub fn reset_for_reprojection(&self, owner: &ProjectionOwner) -> Result<(), ProjectionError> {
        if owner.account_id.is_empty() {
            return Err(ProjectionError::StaleBinding);
        }
        let mut authority = self.authority.lock().map_err(|_| ProjectionError::Io)?;
        authority.binding = None;
        authority.invalidated_at = None;
        self.lock()
    }

    fn begin_recovery_ledger(
        &self,
        artifacts: impl IntoIterator<Item = String>,
        agent_lock_required: bool,
    ) -> Result<(), ProjectionError> {
        let mut recovery = self.recovery.lock().map_err(|_| ProjectionError::Io)?;
        let ledger = recovery.get_or_insert_with(RecoveryLedger::default);
        for artifact in artifacts {
            ledger.remember(artifact);
        }
        ledger.agent_lock_required |= agent_lock_required;
        ledger.directory_sync_required = true;
        Ok(())
    }

    fn mark_pending_recovery(&self, agent_lock_required: bool) {
        self.pending_lock
            .fetch_or(agent_lock_required, Ordering::SeqCst);
        if let Ok(mut recovery) = self.recovery.lock() {
            let ledger = recovery.get_or_insert_with(RecoveryLedger::default);
            ledger.agent_lock_required |= agent_lock_required;
            ledger.directory_sync_required = true;
        }
    }

    fn recover_pending(
        &self,
        directory: &SecureDirectory,
        state: &mut Option<ProjectionState>,
        stage_hook: &mut impl FnMut(ReplaceStage) -> Result<(), ProjectionError>,
    ) -> Result<(), ProjectionError> {
        {
            let mut recovery = self.recovery.lock().map_err(|_| ProjectionError::Io)?;
            if recovery.is_none() && state.is_none() {
                let artifacts = directory.artifact_names()?;
                if !artifacts.is_empty() {
                    let mut ledger = RecoveryLedger {
                        agent_lock_required: true,
                        directory_sync_required: true,
                        ..RecoveryLedger::default()
                    };
                    for artifact in artifacts {
                        ledger.remember(artifact);
                    }
                    *recovery = Some(ledger);
                    self.pending_lock.store(true, Ordering::SeqCst);
                }
            }
        }

        let (agent_lock_required, mut artifacts) = {
            let recovery = self.recovery.lock().map_err(|_| ProjectionError::Io)?;
            let Some(ledger) = recovery.as_ref() else {
                return Ok(());
            };
            (ledger.agent_lock_required, ledger.artifacts.clone())
        };

        if agent_lock_required || self.pending_lock.load(Ordering::SeqCst) {
            self.agent.lock()?;
            if let Some(previous) = state.take() {
                if let Some(name) = previous.path.file_name().and_then(|name| name.to_str()) {
                    artifacts.push(name.to_owned());
                }
            }
            artifacts.extend(directory.artifact_names()?);
        }
        if let Ok(mut pending) = self.pending_cleanup.lock() {
            for path in pending.drain(..) {
                if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                    artifacts.push(name.to_owned());
                }
            }
        }
        artifacts.sort();
        artifacts.dedup();
        for artifact in &artifacts {
            if !is_projection_artifact(artifact) {
                continue;
            }
            stage_hook(ReplaceStage::BeforeCleanupRemove)?;
            directory.remove(artifact)?;
        }
        stage_hook(ReplaceStage::BeforeCleanupDirectorySync)?;
        directory.sync()?;
        *self.recovery.lock().map_err(|_| ProjectionError::Io)? = None;
        self.pending_lock.store(false, Ordering::SeqCst);
        self.pending_directory_sync.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub fn replace(
        &self,
        input: AutoFillProjectionInput,
    ) -> Result<ProjectionReceipt, ProjectionError> {
        self.replace_with_hook(input, |_| Ok(()))
    }

    fn replace_with_hook(
        &self,
        input: AutoFillProjectionInput,
        stage_hook: impl FnMut(ReplaceStage) -> Result<(), ProjectionError>,
    ) -> Result<ProjectionReceipt, ProjectionError> {
        self.replace_with_hook_mode(input, false, None, stage_hook)
    }

    fn replace_fresh_if_current(
        &self,
        input: AutoFillProjectionInput,
        expected_generation: &str,
        expected_vault_revision: u64,
    ) -> Result<ProjectionReceipt, ProjectionError> {
        self.replace_with_hook_mode(
            input,
            true,
            Some((expected_generation, expected_vault_revision)),
            |_| Ok(()),
        )
    }

    fn replace_with_hook_mode(
        &self,
        mut input: AutoFillProjectionInput,
        force_fresh_generation: bool,
        expected_current: Option<(&str, u64)>,
        mut stage_hook: impl FnMut(ReplaceStage) -> Result<(), ProjectionError>,
    ) -> Result<ProjectionReceipt, ProjectionError> {
        validate_input(&input)?;
        let directory = SecureDirectory::open(&self.root)?;
        let mut state = self.state.lock().map_err(|_| ProjectionError::Io)?;
        self.recover_pending(&directory, &mut state, &mut stage_hook)?;
        self.retry_pending_cleanup(&directory, &mut stage_hook)?;
        if expected_current.is_some_and(|expected| {
            state
                .as_ref()
                .map(|current| (current.generation.as_str(), current.vault_revision))
                != Some(expected)
        }) {
            return Err(ProjectionError::StaleRevision);
        }
        let same_account = state
            .as_ref()
            .is_some_and(|current| current.account_id == input.account_id);
        let vault_revision = if same_account {
            state
                .as_ref()
                .unwrap()
                .vault_revision
                .checked_add(1)
                .ok_or(ProjectionError::InvalidInput)?
        } else {
            1
        };

        let (generation, key) = if same_account && !force_fresh_generation {
            let current = state.as_ref().unwrap();
            (current.generation.clone(), Zeroizing::new(current.key))
        } else {
            let mut key = [0_u8; KEY_BYTES];
            rand::rng().fill_bytes(&mut key);
            (uuid::Uuid::new_v4().to_string(), Zeroizing::new(key))
        };
        let account_id = input.account_id.clone();
        let mut projection = AutoFillProjection::take_from_input(&mut input, vault_revision);
        let mut plaintext = match serde_json::to_vec(&projection) {
            Ok(plaintext) => plaintext,
            Err(_) => {
                projection.zeroize();
                return Err(ProjectionError::InvalidInput);
            }
        };
        let encrypted = encrypt_projection(&plaintext, &key);
        plaintext.zeroize();
        projection.zeroize();
        let encrypted = encrypted?;
        let final_name = projection_file_name(&account_id);
        let final_path = directory.path(&final_name);
        let temp_name = format!(".projection-{}.tmp", uuid::Uuid::new_v4());
        let backup_name = format!(".projection-{}.bak", uuid::Uuid::new_v4());
        let had_final = directory.validate_existing_file(&final_name)?;
        let mut transaction_artifacts =
            vec![temp_name.clone(), backup_name.clone(), final_name.clone()];
        if let Some(previous_name) = state
            .as_ref()
            .and_then(|previous| previous.path.file_name())
            .and_then(|name| name.to_str())
        {
            transaction_artifacts.push(previous_name.to_owned());
        }
        self.begin_recovery_ledger(transaction_artifacts, true)?;
        let mut rollback_failed = false;

        let write_result = (|| {
            let mut temp = directory.create_file(&temp_name)?;
            temp.write_all(&encrypted)
                .map_err(|_| ProjectionError::Io)?;
            temp.sync_all().map_err(|_| ProjectionError::Io)?;
            stage_hook(ReplaceStage::AfterTempSync)?;
            if had_final {
                directory.rename(&final_name, &backup_name)?;
                if let Err(error) = stage_hook(ReplaceStage::AfterBackupRename) {
                    rollback_failed = rollback_replacement(
                        &directory,
                        &final_name,
                        &backup_name,
                        had_final,
                        &mut stage_hook,
                    )
                    .is_err();
                    return Err(error);
                }
                if let Err(error) = directory.sync() {
                    rollback_failed = rollback_replacement(
                        &directory,
                        &final_name,
                        &backup_name,
                        had_final,
                        &mut stage_hook,
                    )
                    .is_err();
                    return Err(error);
                }
            }
            if let Err(error) = directory.rename(&temp_name, &final_name) {
                if had_final {
                    rollback_failed = rollback_replacement(
                        &directory,
                        &final_name,
                        &backup_name,
                        had_final,
                        &mut stage_hook,
                    )
                    .is_err();
                }
                return Err(error);
            }
            if let Err(error) = stage_hook(ReplaceStage::AfterFinalRename) {
                rollback_failed = rollback_replacement(
                    &directory,
                    &final_name,
                    &backup_name,
                    had_final,
                    &mut stage_hook,
                )
                .is_err();
                return Err(error);
            }
            if let Err(error) = directory.sync() {
                rollback_failed = rollback_replacement(
                    &directory,
                    &final_name,
                    &backup_name,
                    had_final,
                    &mut stage_hook,
                )
                .is_err();
                return Err(error);
            }
            Ok(())
        })();
        if write_result.is_err() {
            let temp_cleanup = stage_hook(ReplaceStage::BeforeTempCleanupRemove)
                .and_then(|_| directory.remove(&temp_name).map(|_| ()))
                .and_then(|_| stage_hook(ReplaceStage::BeforeTempCleanupDirectorySync))
                .and_then(|_| directory.sync());
            if temp_cleanup.is_err() {
                self.pending_directory_sync.store(true, Ordering::SeqCst);
            }
            self.mark_pending_recovery(true);
            if rollback_failed {
                self.pending_lock.store(true, Ordering::SeqCst);
                if self.agent.lock().is_ok() {
                    if let Some(previous) = state.take() {
                        self.remember_cleanup(previous.path.clone());
                    }
                    self.pending_lock.store(false, Ordering::SeqCst);
                }
            }
            return write_result.map(|_| unreachable!());
        }
        if let Err(error) = directory.validate_path_binding() {
            if rollback_replacement(
                &directory,
                &final_name,
                &backup_name,
                had_final,
                &mut stage_hook,
            )
            .is_err()
            {
                self.mark_pending_recovery(true);
                self.pending_lock.store(true, Ordering::SeqCst);
                if self.agent.lock().is_ok() {
                    if let Some(previous) = state.take() {
                        self.remember_cleanup(previous.path.clone());
                    }
                    self.pending_lock.store(false, Ordering::SeqCst);
                }
            }
            self.mark_pending_recovery(true);
            return Err(error);
        }

        let provision = ProjectionProvision {
            generation: generation.clone(),
            account_id: account_id.clone(),
            vault_revision,
            key: key.to_vec(),
            lease_duration_seconds: 30,
            projection_path: final_path.clone(),
        };
        if let Err(error) = self.agent.provision(provision) {
            self.mark_pending_recovery(true);
            self.pending_lock.store(true, Ordering::SeqCst);
            if self.agent.lock().is_err() {
                return Err(error);
            }
            state.take();
            let cleanup = (|| {
                stage_hook(ReplaceStage::BeforeProvisionRollback)?;
                for artifact in directory.artifact_names()? {
                    directory.remove(&artifact)?;
                }
                directory.sync()
            })();
            if cleanup.is_ok() {
                *self.recovery.lock().map_err(|_| ProjectionError::Io)? = None;
                self.pending_lock.store(false, Ordering::SeqCst);
                self.pending_directory_sync.store(false, Ordering::SeqCst);
            }
            return Err(cleanup.err().unwrap_or(error));
        }

        let previous_path = state.as_ref().map(|previous| previous.path.clone());
        *state = Some(ProjectionState {
            account_id,
            generation: generation.clone(),
            vault_revision,
            key: *key,
            path: final_path.clone(),
        });
        if had_final {
            self.remember_cleanup(directory.path(&backup_name));
        }
        if let Some(previous_path) = previous_path {
            if previous_path != final_path {
                self.remember_cleanup(previous_path);
            }
        }
        if let Err(error) = stage_hook(ReplaceStage::BeforeCleanupRemove)
            .and_then(|_| self.retry_pending_cleanup(&directory, &mut stage_hook))
        {
            self.mark_pending_recovery(true);
            return Err(error);
        }
        *self.recovery.lock().map_err(|_| ProjectionError::Io)? = None;
        Ok(ProjectionReceipt {
            path: final_path,
            generation,
            vault_revision,
        })
    }

    fn remember_cleanup(&self, path: PathBuf) {
        if let Ok(mut pending) = self.pending_cleanup.lock() {
            if !pending.contains(&path) {
                pending.push(path);
            }
        }
    }

    fn retry_pending_cleanup(
        &self,
        directory: &SecureDirectory,
        stage_hook: &mut impl FnMut(ReplaceStage) -> Result<(), ProjectionError>,
    ) -> Result<(), ProjectionError> {
        if self.pending_directory_sync.load(Ordering::SeqCst) {
            stage_hook(ReplaceStage::BeforeCleanupDirectorySync)?;
            directory.sync()?;
            self.pending_directory_sync.store(false, Ordering::SeqCst);
        }
        let mut pending = self
            .pending_cleanup
            .lock()
            .map_err(|_| ProjectionError::Io)?;
        let mut retained = Vec::new();
        let mut removed_any = false;
        for path in pending.drain(..) {
            let contained = path.parent() == Some(directory.root.as_path());
            let name = path.file_name().and_then(|name| name.to_str());
            if !contained || name.is_none() {
                retained.push(path);
                continue;
            }
            match directory.remove(name.unwrap()) {
                Ok(removed) => removed_any |= removed,
                Err(_) => retained.push(path),
            }
        }
        *pending = retained;
        if removed_any {
            if let Err(error) =
                stage_hook(ReplaceStage::BeforeCleanupDirectorySync).and_then(|_| directory.sync())
            {
                self.pending_directory_sync.store(true, Ordering::SeqCst);
                return Err(error);
            }
        }
        if pending.is_empty() {
            Ok(())
        } else {
            Err(ProjectionError::Io)
        }
    }

    pub fn clear(&self, account_id: &str) -> Result<(), ProjectionError> {
        self.clear_with_hook(account_id, |_| Ok(()))
    }

    fn clear_with_hook(
        &self,
        account_id: &str,
        mut stage_hook: impl FnMut(ReplaceStage) -> Result<(), ProjectionError>,
    ) -> Result<(), ProjectionError> {
        if account_id.is_empty() {
            return Err(ProjectionError::InvalidInput);
        }
        let mut state = self.state.lock().map_err(|_| ProjectionError::Io)?;
        let directory = SecureDirectory::open(&self.root)?;
        self.recover_pending(&directory, &mut state, &mut |_| Ok(()))?;
        let name = projection_file_name(account_id);
        let is_active = state
            .as_ref()
            .is_some_and(|current| current.account_id == account_id);
        self.begin_recovery_ledger([name.clone()], is_active)?;
        if is_active {
            self.pending_lock.store(true, Ordering::SeqCst);
            self.agent.lock()?;
            state.take();
        }
        let result = (|| {
            stage_hook(ReplaceStage::BeforeClearRemove)?;
            if directory.remove(&name)? {
                stage_hook(ReplaceStage::BeforeClearDirectorySync)?;
                directory.sync()?;
            }
            Ok(())
        })();
        if result.is_err() {
            self.mark_pending_recovery(is_active);
            return result;
        }
        *self.recovery.lock().map_err(|_| ProjectionError::Io)? = None;
        self.pending_lock.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub fn lock(&self) -> Result<(), ProjectionError> {
        self.lock_with_hook(|_| Ok(()))
    }

    fn lock_with_hook(
        &self,
        mut stage_hook: impl FnMut(ReplaceStage) -> Result<(), ProjectionError>,
    ) -> Result<(), ProjectionError> {
        let mut state = self.state.lock().map_err(|_| ProjectionError::Io)?;
        let remembered = state
            .as_ref()
            .and_then(|current| current.path.file_name())
            .and_then(|name| name.to_str())
            .map(str::to_owned)
            .into_iter();
        self.begin_recovery_ledger(remembered, true)?;
        self.pending_lock.store(true, Ordering::SeqCst);
        self.agent.lock()?;
        state.take();
        let directory = SecureDirectory::open(&self.root)?;
        let artifacts = directory.artifact_names()?;
        self.begin_recovery_ledger(artifacts.clone(), true)?;
        for artifact in artifacts {
            stage_hook(ReplaceStage::BeforeLockRemove)?;
            if let Err(error) = directory.remove(&artifact) {
                self.mark_pending_recovery(true);
                return Err(error);
            }
        }
        stage_hook(ReplaceStage::BeforeLockDirectorySync)?;
        if let Err(error) = directory.sync() {
            self.mark_pending_recovery(true);
            return Err(error);
        }
        *self.recovery.lock().map_err(|_| ProjectionError::Io)? = None;
        self.pending_lock.store(false, Ordering::SeqCst);
        self.pending_directory_sync.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub fn renew_lease(&self) -> Result<(), ProjectionError> {
        let mut state = self.state.lock().map_err(|_| ProjectionError::Io)?;
        let directory = SecureDirectory::open(&self.root)?;
        self.recover_pending(&directory, &mut state, &mut |_| Ok(()))?;
        self.retry_pending_cleanup(&directory, &mut |_| Ok(()))?;
        if let Some(current) = state.as_ref() {
            self.agent
                .renew(&current.generation, &current.account_id, 30)?;
        }
        Ok(())
    }

    pub fn renew_or_reproject(&self) -> Result<(), ProjectionError> {
        match self.renew_lease() {
            Ok(()) => Ok(()),
            Err(ProjectionError::AgentUnavailable | ProjectionError::StaleRevision) => {
                let Some((generation, vault_revision, input)) =
                    self.current_reprojection_input()?
                else {
                    return Ok(());
                };
                self.replace_fresh_if_current(input, &generation, vault_revision)
                    .map(|_| ())
            }
            Err(error) => Err(error),
        }
    }

    fn current_reprojection_input(
        &self,
    ) -> Result<Option<(String, u64, AutoFillProjectionInput)>, ProjectionError> {
        let Some((generation, account_id, vault_revision, key, name, expected_path)) = self
            .state
            .lock()
            .map_err(|_| ProjectionError::Io)?
            .as_ref()
            .map(|current| {
                (
                    current.generation.clone(),
                    current.account_id.clone(),
                    current.vault_revision,
                    Zeroizing::new(current.key),
                    projection_file_name(&current.account_id),
                    current.path.clone(),
                )
            })
        else {
            return Ok(None);
        };
        let directory = SecureDirectory::open(&self.root)?;
        if directory.path(&name) != expected_path {
            return Err(ProjectionError::Io);
        }
        let mut envelope = directory.read_file(&name)?;
        let projection_result = decrypt_projection(&envelope, key.as_slice());
        envelope.zeroize();
        let mut projection = projection_result?;
        if projection.account_id != account_id || projection.vault_revision != vault_revision {
            projection.zeroize();
            return Err(ProjectionError::StaleRevision);
        }
        let input = AutoFillProjectionInput {
            account_id: std::mem::take(&mut projection.account_id),
            created_at: std::mem::take(&mut projection.created_at),
            logins: std::mem::take(&mut projection.logins),
            bindings: std::mem::take(&mut projection.bindings),
            history: std::mem::take(&mut projection.history),
        };
        projection.zeroize();
        Ok(Some((generation, vault_revision, input)))
    }

    #[cfg(test)]
    fn replace_with_interruption_for_test(
        &self,
        input: AutoFillProjectionInput,
    ) -> Result<ProjectionReceipt, ProjectionError> {
        self.replace_with_hook(input, |stage| {
            if stage == ReplaceStage::AfterTempSync {
                Err(ProjectionError::Interrupted)
            } else {
                Ok(())
            }
        })
    }
}

pub struct IpcProjectionAgent;

impl ProjectionAgent for IpcProjectionAgent {
    fn provision(&self, provision: ProjectionProvision) -> Result<(), ProjectionError> {
        let path = provision
            .projection_path
            .to_str()
            .ok_or(ProjectionError::InvalidInput)?
            .to_owned();
        let request = AgentRequest::projection_provision(
            provision.generation.clone(),
            provision.account_id.clone(),
            provision.vault_revision,
            provision.key.clone(),
            provision.lease_duration_seconds,
            path,
        );
        perform_agent_request(request)
    }

    fn lock(&self) -> Result<(), ProjectionError> {
        AgentClient::system_default()
            .and_then(|client| client.perform(AgentOperation::Lock))
            .map(|_| ())
            .map_err(map_agent_error)
    }

    fn renew(
        &self,
        generation: &str,
        account_id: &str,
        lease_seconds: u64,
    ) -> Result<(), ProjectionError> {
        perform_agent_request(AgentRequest::lease_renewal(
            generation.to_owned(),
            account_id.to_owned(),
            lease_seconds,
        ))
    }
}

fn perform_agent_request(request: AgentRequest) -> Result<(), ProjectionError> {
    AgentClient::system_default()
        .and_then(|client| client.perform_request(request))
        .map(|_| ())
        .map_err(map_agent_error)
}

fn map_agent_error(error: AgentErrorCode) -> ProjectionError {
    match error {
        AgentErrorCode::StaleRevision => ProjectionError::StaleRevision,
        AgentErrorCode::CorruptProjection => ProjectionError::CorruptProjection,
        _ => ProjectionError::AgentUnavailable,
    }
}

pub type SystemProjectionManager = ProjectionManager<IpcProjectionAgent>;

pub fn system_projection_manager(
) -> Result<std::sync::Arc<SystemProjectionManager>, ProjectionError> {
    let root =
        crate::autofill_ipc::system_app_group_container_path().map_err(|_| ProjectionError::Io)?;
    let manager = std::sync::Arc::new(ProjectionManager::new(
        root,
        std::sync::Arc::new(IpcProjectionAgent),
    ));
    let weak = std::sync::Arc::downgrade(&manager);
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(10));
        let Some(manager) = weak.upgrade() else { break };
        let _ = manager.renew_or_reproject();
    });
    Ok(manager)
}

fn command_error(error: ProjectionError) -> &'static str {
    match error {
        ProjectionError::InvalidInput => "invalid_input",
        ProjectionError::StaleRevision => "stale_revision",
        ProjectionError::CorruptProjection => "corrupt_projection",
        ProjectionError::AgentUnavailable => "agent_unavailable",
        ProjectionError::Interrupted | ProjectionError::Io => "projection_unavailable",
        ProjectionError::StaleBinding => "stale_binding",
    }
}

fn run_projection_lifecycle_with_receipt_clear<T, E>(
    receipts: &AutoFillRepromptReceiptStore,
    operation: impl FnOnce() -> Result<T, E>,
) -> Result<T, E> {
    receipts.clear();
    operation()
}

#[tauri::command]
pub fn autofill_capture_projection_binding(
    manager: tauri::State<'_, std::sync::Arc<SystemProjectionManager>>,
    broker: tauri::State<'_, SessionBroker>,
    account_id: String,
) -> Result<ProjectionBindingReceipt, &'static str> {
    let context = broker.projection_context().map_err(|_| "stale_binding")?;
    let owner = ProjectionOwner::from_context(&context).map_err(command_error)?;
    manager
        .capture_binding(&account_id, &owner)
        .map_err(command_error)
}

#[tauri::command]
pub fn autofill_replace_projection(
    manager: tauri::State<'_, std::sync::Arc<SystemProjectionManager>>,
    broker: tauri::State<'_, SessionBroker>,
    receipts: tauri::State<'_, std::sync::Arc<AutoFillRepromptReceiptStore>>,
    suggestion_monitor: tauri::State<'_, crate::suggestion_count::SuggestionCountMonitor>,
    input: AutoFillProjectionInput,
    binding_token: String,
) -> Result<u64, &'static str> {
    let result = run_projection_lifecycle_with_receipt_clear(&receipts, || {
        let context = broker.projection_context().map_err(|_| "stale_binding")?;
        let owner = ProjectionOwner::from_context(&context).map_err(command_error)?;
        manager
            .replace_bound(input, &binding_token, &owner)
            .map(|receipt| receipt.vault_revision)
            .map_err(command_error)
    });
    if result.is_ok() {
        suggestion_monitor.invalidate();
    }
    result
}

#[tauri::command]
pub fn autofill_clear_projection(
    manager: tauri::State<'_, std::sync::Arc<SystemProjectionManager>>,
    broker: tauri::State<'_, SessionBroker>,
    receipts: tauri::State<'_, std::sync::Arc<AutoFillRepromptReceiptStore>>,
    suggestion_monitor: tauri::State<'_, crate::suggestion_count::SuggestionCountMonitor>,
    account_id: String,
) -> Result<(), &'static str> {
    suggestion_monitor.clear();
    run_projection_lifecycle_with_receipt_clear(&receipts, || {
        let context = broker.projection_context().map_err(|_| "stale_binding")?;
        if context.active_account_id.as_deref() == Some(account_id.as_str()) {
            let owner = ProjectionOwner {
                process_generation: context.process_generation,
                ownership_epoch: context.ownership_epoch,
                account_id,
            };
            manager.invalidate_and_lock(&owner).map_err(command_error)
        } else {
            manager.clear(&account_id).map_err(command_error)
        }
    })
}

#[tauri::command]
pub fn autofill_lock_projection(
    manager: tauri::State<'_, std::sync::Arc<SystemProjectionManager>>,
    broker: tauri::State<'_, SessionBroker>,
    receipts: tauri::State<'_, std::sync::Arc<AutoFillRepromptReceiptStore>>,
    suggestion_monitor: tauri::State<'_, crate::suggestion_count::SuggestionCountMonitor>,
) -> Result<(), &'static str> {
    suggestion_monitor.clear();
    run_projection_lifecycle_with_receipt_clear(&receipts, || {
        let context = broker.projection_context().map_err(|_| "stale_binding")?;
        let owner = ProjectionOwner {
            process_generation: context.process_generation,
            ownership_epoch: context.ownership_epoch,
            account_id: context.active_account_id.unwrap_or_default(),
        };
        manager.invalidate_and_lock(&owner).map_err(command_error)
    })
}

#[tauri::command]
pub fn autofill_reset_projection_for_reprojection(
    manager: tauri::State<'_, std::sync::Arc<SystemProjectionManager>>,
    broker: tauri::State<'_, SessionBroker>,
    receipts: tauri::State<'_, std::sync::Arc<AutoFillRepromptReceiptStore>>,
    suggestion_monitor: tauri::State<'_, crate::suggestion_count::SuggestionCountMonitor>,
) -> Result<(), &'static str> {
    suggestion_monitor.clear();
    run_projection_lifecycle_with_receipt_clear(&receipts, || {
        let context = broker.projection_context().map_err(|_| "stale_binding")?;
        let owner = ProjectionOwner {
            process_generation: context.process_generation,
            ownership_epoch: context.ownership_epoch,
            account_id: context.active_account_id.unwrap_or_default(),
        };
        manager
            .reset_for_reprojection(&owner)
            .map_err(command_error)
    })
}

fn validate_input(input: &AutoFillProjectionInput) -> Result<(), ProjectionError> {
    let active_cipher_ids: HashSet<&str> = input
        .logins
        .iter()
        .map(|login| login.cipher_id.as_str())
        .collect();
    let unique_logins = active_cipher_ids.len() == input.logins.len();
    let unique_bindings = input
        .bindings
        .iter()
        .map(|binding| binding.bundle_id.trim().to_ascii_lowercase())
        .collect::<HashSet<_>>()
        .len()
        == input.bindings.len();
    let unique_history = input
        .history
        .iter()
        .map(|entry| {
            (
                entry.context_key.trim().to_ascii_lowercase(),
                entry.cipher_id.as_str(),
            )
        })
        .collect::<HashSet<_>>()
        .len()
        == input.history.len();
    if input.account_id.is_empty()
        || input.created_at.is_empty()
        || !unique_logins
        || !unique_bindings
        || !unique_history
        || input.logins.iter().any(|login| {
            login.cipher_id.is_empty()
                || login
                    .notes
                    .as_ref()
                    .is_some_and(|notes| notes.chars().count() > 4_096)
                || login
                    .uris
                    .iter()
                    .any(|uri| uri.uri.is_empty() || uri.match_type > 5)
                || login.last_used_at == Some(0)
        })
        || input.bindings.iter().any(|binding| {
            binding.bundle_id.trim().is_empty()
                || binding.cipher_id.is_empty()
                || !active_cipher_ids.contains(binding.cipher_id.as_str())
        })
        || input.history.iter().any(|entry| {
            entry.context_key.is_empty()
                || entry.cipher_id.is_empty()
                || entry.successful_selection_count == 0
                || entry.last_selected_at == 0
                || !active_cipher_ids.contains(entry.cipher_id.as_str())
        })
    {
        return Err(ProjectionError::InvalidInput);
    }
    Ok(())
}

fn projection_path(root: &Path, account_id: &str) -> PathBuf {
    root.join(projection_file_name(account_id))
}

fn projection_file_name(account_id: &str) -> String {
    let digest = Sha256::digest(account_id.as_bytes());
    format!("projection-{digest:x}.bwaf")
}

fn encrypt_projection(plaintext: &[u8], key: &[u8; KEY_BYTES]) -> Result<Vec<u8>, ProjectionError> {
    let mut nonce_bytes = [0_u8; NONCE_BYTES];
    rand::rng().fill_bytes(&mut nonce_bytes);
    let mut header = Vec::with_capacity(HEADER_BYTES);
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&FORMAT_VERSION.to_be_bytes());
    header.extend_from_slice(&nonce_bytes);
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext,
                aad: &header,
            },
        )
        .map_err(|_| ProjectionError::CorruptProjection)?;
    header.extend_from_slice(&ciphertext);
    Ok(header)
}

pub fn decrypt_projection(
    envelope: &[u8],
    key: &[u8],
) -> Result<AutoFillProjection, ProjectionError> {
    if envelope.len() <= HEADER_BYTES + 16 || key.len() != KEY_BYTES {
        return Err(ProjectionError::CorruptProjection);
    }
    if &envelope[..MAGIC.len()] != MAGIC
        || u16::from_be_bytes(envelope[MAGIC.len()..MAGIC.len() + 2].try_into().unwrap())
            != FORMAT_VERSION
    {
        return Err(ProjectionError::CorruptProjection);
    }
    let nonce_start = MAGIC.len() + 2;
    let header = &envelope[..HEADER_BYTES];
    let nonce = Nonce::from_slice(&envelope[nonce_start..HEADER_BYTES]);
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let mut plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: &envelope[HEADER_BYTES..],
                aad: header,
            },
        )
        .map_err(|_| ProjectionError::CorruptProjection)?;
    let projection =
        serde_json::from_slice(&plaintext).map_err(|_| ProjectionError::CorruptProjection);
    plaintext.zeroize();
    projection
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    #[test]
    fn real_projection_lifecycle_wrapper_clears_reprompt_receipts_even_when_lock_fails() {
        use crate::autofill_contract::AutoFillSecretField;
        use crate::autofill_reprompt::{AutoFillRepromptReceiptStore, AutoFillRepromptScope};

        let receipts = AutoFillRepromptReceiptStore::default();
        let scope = AutoFillRepromptScope {
            account_id: "account-a".to_owned(),
            candidate_id: "cipher-a".to_owned(),
            field: AutoFillSecretField::Password,
            generation: "00000000-0000-4000-8000-000000000004".to_owned(),
            context_token: "context-a".to_owned(),
        };
        let receipt = receipts
            .begin(
                scope.clone(),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();

        let result: Result<(), ProjectionError> =
            run_projection_lifecycle_with_receipt_clear(&receipts, || {
                Err(ProjectionError::AgentUnavailable)
            });

        assert_eq!(result, Err(ProjectionError::AgentUnavailable));
        assert!(!receipts.cancel(&receipt, &scope));
    }

    #[derive(Default)]
    struct RecordingAgent {
        provisions: Mutex<Vec<ProjectionProvision>>,
        fail: AtomicBool,
        fail_lock: AtomicBool,
        fail_renew: AtomicBool,
        locks: AtomicUsize,
        renewals: AtomicUsize,
    }

    impl ProjectionAgent for RecordingAgent {
        fn provision(&self, provision: ProjectionProvision) -> Result<(), ProjectionError> {
            if self.fail.load(Ordering::SeqCst) {
                return Err(ProjectionError::AgentUnavailable);
            }
            self.provisions.lock().unwrap().push(provision);
            Ok(())
        }

        fn lock(&self) -> Result<(), ProjectionError> {
            self.locks.fetch_add(1, Ordering::SeqCst);
            if self.fail_lock.load(Ordering::SeqCst) {
                return Err(ProjectionError::AgentUnavailable);
            }
            Ok(())
        }

        fn renew(
            &self,
            _generation: &str,
            _account_id: &str,
            _lease_seconds: u64,
        ) -> Result<(), ProjectionError> {
            self.renewals.fetch_add(1, Ordering::SeqCst);
            if self.fail_renew.load(Ordering::SeqCst) {
                return Err(ProjectionError::AgentUnavailable);
            }
            Ok(())
        }
    }

    fn input(account_id: &str, _revision: u64) -> AutoFillProjectionInput {
        AutoFillProjectionInput {
            account_id: account_id.to_owned(),
            created_at: "2026-08-08T08:00:00.000Z".to_owned(),
            logins: vec![AutoFillLogin {
                cipher_id: "login-1".to_owned(),
                name: "Example".to_owned(),
                notes: Some("Production account".to_owned()),
                username: "fixture-user@example.test".to_owned(),
                password: "fixture-password-value".to_owned(),
                uris: vec![AutoFillUri {
                    uri: "https://fixture.example.test/login".to_owned(),
                    match_type: 0,
                }],
                totp: "JBSWY3DPEHPK3PXP".to_owned(),
                favorite: true,
                reprompt: false,
                last_used_at: Some(1_786_147_200_000),
            }],
            bindings: vec![],
            history: vec![],
        }
    }

    fn temporary_directory() -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("barwarden-projection-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        path
    }

    #[test]
    fn accepts_account_scoped_matching_metadata_and_recent_timestamp() {
        let json = serde_json::json!({
            "accountId": "account-a",
            "createdAt": "2026-08-08T08:00:00Z",
            "logins": [{
                "cipherId": "cipher-a",
                "name": "Example",
                "username": "person@example.test",
                "password": "secret",
                "uris": [],
                "totp": "seed",
                "favorite": false,
                "reprompt": false,
                "lastUsedAt": 1786233600000_u64
            }],
            "bindings": [{ "bundleId": "com.example.app", "cipherId": "cipher-a" }],
            "history": [{
                "contextKey": "app:com.example.app",
                "cipherId": "cipher-a",
                "successfulSelectionCount": 2,
                "lastSelectedAt": 1786233600000_u64
            }]
        });

        let decoded = serde_json::from_value::<AutoFillProjectionInput>(json).unwrap();
        assert_eq!(decoded.logins[0].last_used_at, Some(1_786_233_600_000));
        assert_eq!(decoded.history[0].last_selected_at, 1_786_233_600_000);
        assert_eq!(validate_input(&decoded), Ok(()));
    }

    #[test]
    fn uri_match_wire_accepts_only_the_six_numeric_bitwarden_values() {
        let wire = |match_type: serde_json::Value| {
            serde_json::json!({
                "accountId": "account-a",
                "createdAt": "2026-08-08T08:00:00Z",
                "logins": [{
                    "cipherId": "login-1", "name": "Example", "username": "person@example.test",
                    "password": "secret", "uris": [{
                        "uri": "https://example.test", "matchType": match_type
                    }], "totp": "seed", "favorite": false, "reprompt": false
                }],
                "bindings": [], "history": []
            })
        };
        for match_type in 0_u8..=5 {
            let decoded = serde_json::from_value::<AutoFillProjectionInput>(wire(
                serde_json::json!(match_type),
            ))
            .unwrap();
            assert_eq!(validate_input(&decoded), Ok(()));
        }

        assert_eq!(
            validate_input(&serde_json::from_value(wire(serde_json::json!(6))).unwrap()),
            Err(ProjectionError::InvalidInput)
        );

        assert!(
            serde_json::from_value::<AutoFillProjectionInput>(wire(serde_json::json!("default")))
                .is_err()
        );
    }

    #[test]
    fn rejects_duplicate_or_dangling_matching_metadata_as_one_projection() {
        let mut duplicate_login = input("account-a", 1);
        duplicate_login
            .logins
            .push(duplicate_login.logins[0].clone());
        assert_eq!(
            validate_input(&duplicate_login),
            Err(ProjectionError::InvalidInput)
        );

        let mut duplicate_bundle = input("account-a", 1);
        duplicate_bundle.bindings = vec![
            AutoFillBinding {
                bundle_id: "COM.Example.App".into(),
                cipher_id: "login-1".into(),
            },
            AutoFillBinding {
                bundle_id: "com.example.app".into(),
                cipher_id: "login-1".into(),
            },
        ];
        assert_eq!(
            validate_input(&duplicate_bundle),
            Err(ProjectionError::InvalidInput)
        );

        let mut duplicate_history = input("account-a", 1);
        let entry = AutoFillHistory {
            context_key: "app:com.example.app".into(),
            cipher_id: "login-1".into(),
            successful_selection_count: 1,
            last_selected_at: 1_786_233_600_000,
        };
        duplicate_history.history = vec![entry.clone(), entry];
        assert_eq!(
            validate_input(&duplicate_history),
            Err(ProjectionError::InvalidInput)
        );

        let mut dangling = input("account-a", 1);
        dangling.bindings = vec![AutoFillBinding {
            bundle_id: "com.example.app".into(),
            cipher_id: "deleted-cipher".into(),
        }];
        assert_eq!(
            validate_input(&dangling),
            Err(ProjectionError::InvalidInput)
        );
    }

    #[test]
    fn replacement_encrypts_all_login_secrets_and_can_be_authenticated() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());

        let receipt = manager.replace(input("account-a", 7)).unwrap();
        let bytes = fs::read(&receipt.path).unwrap();
        let provisions = agent.provisions.lock().unwrap();
        let decoded = decrypt_projection(&bytes, &provisions[0].key).unwrap();

        assert_eq!(decoded.account_id, "account-a");
        assert_eq!(decoded.vault_revision, 1);
        assert_eq!(decoded.logins.len(), 1);
        assert_eq!(
            fs::metadata(&receipt.path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        for leaked in [
            "fixture-user@example.test",
            "fixture-password-value",
            "https://fixture.example.test/login",
            "JBSWY3DPEHPK3PXP",
        ] {
            assert!(!bytes
                .windows(leaked.len())
                .any(|window| window == leaked.as_bytes()));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupt_authenticated_tag_is_rejected() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let receipt = manager.replace(input("account-a", 1)).unwrap();
        let mut bytes = fs::read(receipt.path).unwrap();
        *bytes.last_mut().unwrap() ^= 0x80;

        assert_eq!(
            decrypt_projection(&bytes, &agent.provisions.lock().unwrap()[0].key),
            Err(ProjectionError::CorruptProjection),
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn callers_cannot_force_or_replay_a_revision() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent);
        let current = manager.replace(input("account-a", 9)).unwrap();
        let next = manager.replace(input("account-a", 1)).unwrap();

        assert_eq!(current.vault_revision, 1);
        assert_eq!(next.vault_revision, 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn native_writer_allocates_revision_in_one_shared_mutex() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent);

        let first = manager.replace(input("account-a", 99)).unwrap();
        let second = manager.replace(input("account-a", 100)).unwrap();

        assert_eq!(first.vault_revision, 1);
        assert_eq!(second.vault_revision, 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn multiple_windows_share_one_monotonic_native_revision_allocator() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = Arc::new(ProjectionManager::new(root.clone(), agent));
        let start = Arc::new(std::sync::Barrier::new(8));
        let mut workers = Vec::new();
        for _ in 0..8 {
            let manager = manager.clone();
            let start = start.clone();
            workers.push(std::thread::spawn(move || {
                start.wait();
                manager
                    .replace(input("account-a", 1))
                    .unwrap()
                    .vault_revision
            }));
        }
        let mut revisions: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        revisions.sort_unstable();

        assert_eq!(revisions, (1..=8).collect::<Vec<_>>());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_cross_window_binding_is_rejected_before_revision_or_disk_write() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let owner_a = ProjectionOwner::unlocked("process-1", 7, "account-a");
        let binding_a = manager.capture_binding("account-a", &owner_a).unwrap();

        manager.invalidate_and_lock(&owner_a).unwrap();
        let owner_b = ProjectionOwner::unlocked("process-1", 9, "account-b");
        let binding_b = manager.capture_binding("account-b", &owner_b).unwrap();

        assert_eq!(
            manager.replace_bound(input("account-a", 1), &binding_a.token, &owner_b),
            Err(ProjectionError::StaleBinding)
        );
        assert!(!projection_path(&root, "account-a").exists());
        assert_eq!(agent.provisions.lock().unwrap().len(), 0);

        let receipt = manager
            .replace_bound(input("account-b", 1), &binding_b.token, &owner_b)
            .unwrap();
        assert_eq!(receipt.vault_revision, 1);
        assert!(receipt.path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn binding_requires_the_exact_native_ownership_epoch() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let captured_owner = ProjectionOwner::unlocked("process-1", 7, "account-a");
        let binding = manager
            .capture_binding("account-a", &captured_owner)
            .unwrap();
        let advanced_owner = ProjectionOwner::unlocked("process-1", 8, "account-a");

        assert_eq!(
            manager.replace_bound(input("account-a", 1), &binding.token, &advanced_owner),
            Err(ProjectionError::StaleBinding)
        );
        assert_eq!(agent.provisions.lock().unwrap().len(), 0);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn setup_reprojection_lock_allows_same_owner_to_capture_a_fresh_binding() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let owner = ProjectionOwner::unlocked("process-1", 7, "account-a");
        let original = manager.capture_binding("account-a", &owner).unwrap();
        let original_receipt = manager
            .replace_bound(input("account-a", 1), &original.token, &owner)
            .unwrap();

        manager.reset_for_reprojection(&owner).unwrap();
        let replacement = manager.capture_binding("account-a", &owner).unwrap();

        assert_ne!(replacement.token, original.token);
        assert_eq!(
            manager.replace_bound(input("account-a", 2), &original.token, &owner),
            Err(ProjectionError::StaleBinding)
        );
        let receipt = manager
            .replace_bound(input("account-a", 2), &replacement.token, &owner)
            .unwrap();
        assert_eq!(receipt.vault_revision, 1);
        assert_ne!(receipt.generation, original_receipt.generation);
        assert_eq!(agent.locks.load(Ordering::SeqCst), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_account_switch_can_restore_the_previous_owner_with_a_new_epoch_only() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let broker = SessionBroker::new("process-1");
        broker.attach("main").unwrap();
        broker
            .mutate(
                "main",
                crate::session_broker::SessionBrokerMutation::Unlocked {
                    active_account_id: "account-a".to_owned(),
                    shared_snapshot: Some(serde_json::json!({ "isUnlocked": true })),
                },
            )
            .unwrap();
        let original_owner =
            ProjectionOwner::from_context(&broker.projection_context().unwrap()).unwrap();
        let original_binding = manager
            .capture_binding("account-a", &original_owner)
            .unwrap();

        manager.invalidate_and_lock(&original_owner).unwrap();
        broker
            .mutate(
                "main",
                crate::session_broker::SessionBrokerMutation::Unlocked {
                    active_account_id: "account-a".to_owned(),
                    shared_snapshot: Some(serde_json::json!({ "isUnlocked": true })),
                },
            )
            .unwrap();
        let restored_owner =
            ProjectionOwner::from_context(&broker.projection_context().unwrap()).unwrap();
        let restored_binding = manager
            .capture_binding("account-a", &restored_owner)
            .unwrap();

        assert!(restored_owner.ownership_epoch > original_owner.ownership_epoch);
        assert_ne!(restored_binding.token, original_binding.token);
        assert_eq!(
            manager.replace_bound(
                input("account-a", 1),
                &original_binding.token,
                &restored_owner,
            ),
            Err(ProjectionError::StaleBinding)
        );
        assert_eq!(agent.provisions.lock().unwrap().len(), 0);
        assert!(!projection_path(&root, "account-a").exists());

        let receipt = manager
            .replace_bound(
                input("account-a", 1),
                &restored_binding.token,
                &restored_owner,
            )
            .unwrap();
        assert_eq!(receipt.vault_revision, 1);
        assert_eq!(agent.provisions.lock().unwrap().len(), 1);
        assert!(receipt.path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_lock_retains_pending_state_stops_renewal_and_retries_to_acknowledgement() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let receipt = manager.replace(input("account-a", 1)).unwrap();
        agent.fail_lock.store(true, Ordering::SeqCst);

        assert_eq!(manager.lock(), Err(ProjectionError::AgentUnavailable));
        assert!(manager.state.lock().unwrap().is_some());
        assert!(
            receipt.path.exists(),
            "the Agent-referenced inode remains until lock acknowledgement"
        );
        assert_eq!(
            manager.renew_lease(),
            Err(ProjectionError::AgentUnavailable)
        );
        assert_eq!(agent.renewals.load(Ordering::SeqCst), 0);

        agent.fail_lock.store(false, Ordering::SeqCst);
        manager.renew_lease().unwrap();
        assert!(manager.state.lock().unwrap().is_none());
        assert!(!receipt.path.exists());
        assert_eq!(agent.locks.load(Ordering::SeqCst), 3);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_lease_renewal_reprojects_with_a_fresh_generation_before_retrying() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let receipt = manager.replace(input("account-a", 1)).unwrap();
        agent.fail_renew.store(true, Ordering::SeqCst);

        manager.renew_or_reproject().unwrap();

        let provisions = agent.provisions.lock().unwrap();
        assert_eq!(agent.renewals.load(Ordering::SeqCst), 1);
        assert_eq!(provisions.len(), 2);
        assert_ne!(provisions[0].generation, provisions[1].generation);
        assert_ne!(provisions[0].key, provisions[1].key);
        assert_eq!(provisions[1].vault_revision, 2);
        let encrypted = fs::read(&receipt.path).unwrap();
        let recovered = decrypt_projection(&encrypted, &provisions[1].key).unwrap();
        assert_eq!(recovered.account_id, "account-a");
        assert_eq!(recovered.vault_revision, 2);
        assert_eq!(recovered.logins.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_reprojection_snapshot_cannot_overwrite_a_newer_vault_revision() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        manager.replace(input("account-a", 1)).unwrap();
        let (generation, vault_revision, stale_input) =
            manager.current_reprojection_input().unwrap().unwrap();
        let current = manager.replace(input("account-a", 2)).unwrap();

        assert_eq!(
            manager.replace_fresh_if_current(stale_input, &generation, vault_revision),
            Err(ProjectionError::StaleRevision),
        );

        let provisions = agent.provisions.lock().unwrap();
        assert_eq!(provisions.len(), 2);
        let encrypted = fs::read(&current.path).unwrap();
        let projection = decrypt_projection(&encrypted, &provisions[1].key).unwrap();
        assert_eq!(projection.vault_revision, 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn account_switch_creates_a_fresh_generation_and_removes_previous_file() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let first = manager.replace(input("account-a", 1)).unwrap();
        let second = manager.replace(input("account-b", 1)).unwrap();
        let provisions = agent.provisions.lock().unwrap();

        assert_ne!(provisions[0].generation, provisions[1].generation);
        assert_ne!(provisions[0].key, provisions[1].key);
        assert!(!first.path.exists());
        assert!(second.path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interrupted_temp_write_preserves_current_file_and_cleans_temp_file() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent);
        let current = manager.replace(input("account-a", 1)).unwrap();
        let before = fs::read(&current.path).unwrap();

        assert_eq!(
            manager.replace_with_interruption_for_test(input("account-a", 2)),
            Err(ProjectionError::Interrupted),
        );
        assert_eq!(fs::read(current.path).unwrap(), before);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        manager.renew_lease().unwrap();
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_agent_provision_removes_new_projection() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        agent.fail.store(true, Ordering::SeqCst);
        let manager = ProjectionManager::new(root.clone(), agent);

        assert_eq!(
            manager.replace(input("account-a", 1)),
            Err(ProjectionError::AgentUnavailable)
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_reprovision_locks_before_removing_every_ambiguous_candidate() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let current = manager.replace(input("account-a", 1)).unwrap();
        agent.fail.store(true, Ordering::SeqCst);

        assert_eq!(
            manager.replace(input("account-a", 2)),
            Err(ProjectionError::AgentUnavailable),
        );
        assert!(!current.path.exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        assert!(manager.state.lock().unwrap().is_none());
        assert_eq!(agent.locks.load(Ordering::SeqCst), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ambiguous_provision_failure_keeps_all_files_until_agent_lock_is_acknowledged() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        manager.replace(input("account-a", 1)).unwrap();
        agent.fail.store(true, Ordering::SeqCst);
        agent.fail_lock.store(true, Ordering::SeqCst);

        assert_eq!(
            manager.replace(input("account-a", 2)),
            Err(ProjectionError::AgentUnavailable)
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        assert!(manager.state.lock().unwrap().is_some());
        assert_eq!(agent.renewals.load(Ordering::SeqCst), 0);

        agent.fail_lock.store(false, Ordering::SeqCst);
        manager.renew_lease().unwrap();
        assert!(manager.state.lock().unwrap().is_none());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        assert_eq!(agent.renewals.load(Ordering::SeqCst), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_a_symlink_root_instead_of_following_it() {
        let container = temporary_directory();
        let actual = container.join("actual");
        fs::create_dir(&actual).unwrap();
        fs::set_permissions(&actual, fs::Permissions::from_mode(0o700)).unwrap();
        let link = container.join("root-link");
        std::os::unix::fs::symlink(&actual, &link).unwrap();
        let manager = ProjectionManager::new(link, Arc::new(RecordingAgent::default()));

        assert_eq!(
            manager.replace(input("account-a", 1)),
            Err(ProjectionError::Io)
        );
        assert_eq!(fs::read_dir(actual).unwrap().count(), 0);
        fs::remove_dir_all(container).unwrap();
    }

    #[test]
    fn rejects_an_existing_projection_symlink_or_hardlink() {
        for hardlink in [false, true] {
            let root = temporary_directory();
            let outside = root
                .parent()
                .unwrap()
                .join(format!("outside-{}", uuid::Uuid::new_v4()));
            fs::write(&outside, b"outside").unwrap();
            fs::set_permissions(&outside, fs::Permissions::from_mode(0o600)).unwrap();
            let final_path = projection_path(&root, "account-a");
            if hardlink {
                fs::hard_link(&outside, &final_path).unwrap();
            } else {
                std::os::unix::fs::symlink(&outside, &final_path).unwrap();
            }
            let manager = ProjectionManager::new(root.clone(), Arc::new(RecordingAgent::default()));

            assert_eq!(
                manager.replace(input("account-a", 1)),
                Err(ProjectionError::Io)
            );
            assert_eq!(fs::read(&outside).unwrap(), b"outside");
            fs::remove_dir_all(root).unwrap();
            fs::remove_file(outside).unwrap();
        }
    }

    #[test]
    fn rejects_an_insecure_root_or_existing_file_mode() {
        let root = temporary_directory();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        let manager = ProjectionManager::new(root.clone(), Arc::new(RecordingAgent::default()));
        assert_eq!(
            manager.replace(input("account-a", 1)),
            Err(ProjectionError::Io)
        );
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();

        let final_path = projection_path(&root, "account-a");
        fs::write(&final_path, b"old").unwrap();
        fs::set_permissions(&final_path, fs::Permissions::from_mode(0o644)).unwrap();
        let manager = ProjectionManager::new(root.clone(), Arc::new(RecordingAgent::default()));
        assert_eq!(
            manager.replace(input("account-a", 1)),
            Err(ProjectionError::Io)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rename_and_directory_commit_faults_restore_the_previous_projection() {
        for fault in [
            ReplaceStage::AfterBackupRename,
            ReplaceStage::AfterFinalRename,
        ] {
            let root = temporary_directory();
            let agent = Arc::new(RecordingAgent::default());
            let manager = ProjectionManager::new(root.clone(), agent.clone());
            let current = manager.replace(input("account-a", 1)).unwrap();
            let before = fs::read(&current.path).unwrap();

            assert_eq!(
                manager.replace_with_hook(input("account-a", 2), |stage| {
                    if stage == fault {
                        Err(ProjectionError::Io)
                    } else {
                        Ok(())
                    }
                }),
                Err(ProjectionError::Io)
            );
            assert_eq!(fs::read(&current.path).unwrap(), before);
            assert_eq!(agent.provisions.lock().unwrap().len(), 1);
            manager.renew_lease().unwrap();
            assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn rollback_failure_revokes_the_agent_and_never_renews_uncertain_state() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        manager.replace(input("account-a", 1)).unwrap();
        agent.fail_lock.store(true, Ordering::SeqCst);

        assert_eq!(
            manager.replace_with_hook(input("account-a", 2), |stage| {
                if matches!(
                    stage,
                    ReplaceStage::AfterFinalRename | ReplaceStage::DuringRollback
                ) {
                    Err(ProjectionError::Io)
                } else {
                    Ok(())
                }
            }),
            Err(ProjectionError::Io)
        );
        assert!(manager.pending_lock.load(Ordering::SeqCst));
        assert_eq!(
            manager.renew_lease(),
            Err(ProjectionError::AgentUnavailable)
        );
        assert_eq!(agent.renewals.load(Ordering::SeqCst), 0);

        agent.fail_lock.store(false, Ordering::SeqCst);
        manager.renew_lease().unwrap();
        assert!(manager.state.lock().unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn committed_account_switch_cleanup_fault_is_recoverable_without_split_brain() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let previous = manager.replace(input("account-a", 1)).unwrap();

        assert_eq!(
            manager.replace_with_hook(input("account-b", 1), |stage| {
                if stage == ReplaceStage::BeforeCleanupRemove {
                    Err(ProjectionError::Io)
                } else {
                    Ok(())
                }
            }),
            Err(ProjectionError::Io)
        );

        assert!(previous.path.exists());
        assert!(projection_path(&root, "account-b").exists());
        assert_eq!(
            manager.state.lock().unwrap().as_ref().unwrap().account_id,
            "account-b"
        );
        assert_eq!(
            agent.provisions.lock().unwrap().last().unwrap().account_id,
            "account-b"
        );
        manager.renew_lease().unwrap();
        assert!(manager.state.lock().unwrap().is_none());
        assert_eq!(agent.renewals.load(Ordering::SeqCst), 0);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_directory_sync_fault_is_recorded_and_retried() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent);
        manager.replace(input("account-a", 1)).unwrap();

        assert_eq!(
            manager.replace_with_hook(input("account-b", 1), |stage| {
                if stage == ReplaceStage::BeforeCleanupDirectorySync {
                    Err(ProjectionError::Io)
                } else {
                    Ok(())
                }
            }),
            Err(ProjectionError::Io)
        );

        assert!(manager.pending_directory_sync.load(Ordering::SeqCst));
        manager.renew_lease().unwrap();
        assert!(!manager.pending_directory_sync.load(Ordering::SeqCst));
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn temp_and_provision_secondary_failures_recover_without_orphans_or_renewal() {
        for fault in [
            ReplaceStage::BeforeTempCleanupRemove,
            ReplaceStage::BeforeTempCleanupDirectorySync,
            ReplaceStage::BeforeProvisionRollback,
        ] {
            let root = temporary_directory();
            let agent = Arc::new(RecordingAgent::default());
            let manager = ProjectionManager::new(root.clone(), agent.clone());
            manager.replace(input("account-a", 1)).unwrap();
            if fault == ReplaceStage::BeforeProvisionRollback {
                agent.fail.store(true, Ordering::SeqCst);
            }

            assert!(manager
                .replace_with_hook(input("account-a", 2), |stage| {
                    if stage == fault
                        || (fault != ReplaceStage::BeforeProvisionRollback
                            && stage == ReplaceStage::AfterTempSync)
                    {
                        Err(ProjectionError::Io)
                    } else {
                        Ok(())
                    }
                })
                .is_err());
            agent.fail.store(false, Ordering::SeqCst);
            manager.renew_lease().unwrap();

            assert!(manager.state.lock().unwrap().is_none());
            assert_eq!(agent.renewals.load(Ordering::SeqCst), 0);
            assert_eq!(fs::read_dir(&root).unwrap().count(), 0, "fault={fault:?}");
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn clear_and_lock_secondary_failures_recover_after_agent_ack_and_directory_sync() {
        for fault in [
            ReplaceStage::BeforeClearRemove,
            ReplaceStage::BeforeClearDirectorySync,
            ReplaceStage::BeforeLockRemove,
            ReplaceStage::BeforeLockDirectorySync,
        ] {
            let root = temporary_directory();
            let agent = Arc::new(RecordingAgent::default());
            let manager = ProjectionManager::new(root.clone(), agent.clone());
            let receipt = manager.replace(input("account-a", 1)).unwrap();
            let result = if matches!(
                fault,
                ReplaceStage::BeforeClearRemove | ReplaceStage::BeforeClearDirectorySync
            ) {
                manager.clear_with_hook("account-a", |stage| {
                    if stage == fault {
                        Err(ProjectionError::Io)
                    } else {
                        Ok(())
                    }
                })
            } else {
                manager.lock_with_hook(|stage| {
                    if stage == fault {
                        Err(ProjectionError::Io)
                    } else {
                        Ok(())
                    }
                })
            };

            assert_eq!(result, Err(ProjectionError::Io));
            assert!(manager.pending_lock.load(Ordering::SeqCst));
            manager.renew_lease().unwrap();
            assert!(!receipt.path.exists());
            assert_eq!(fs::read_dir(&root).unwrap().count(), 0, "fault={fault:?}");
            assert_eq!(agent.renewals.load(Ordering::SeqCst), 0);
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn restart_scan_locks_agent_before_cleaning_all_trusted_projection_artifacts() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        {
            let manager = ProjectionManager::new(root.clone(), agent.clone());
            manager.replace(input("account-a", 1)).unwrap();
        }
        for suffix in ["tmp", "bak"] {
            let path = root.join(format!(".projection-{}.{}", uuid::Uuid::new_v4(), suffix));
            fs::write(&path, b"orphan").unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let obsolete = projection_path(&root, "obsolete-account");
        fs::write(&obsolete, b"obsolete").unwrap();
        fs::set_permissions(&obsolete, fs::Permissions::from_mode(0o600)).unwrap();

        let restarted = ProjectionManager::new(root.clone(), agent.clone());
        restarted.renew_lease().unwrap();

        assert_eq!(agent.locks.load(Ordering::SeqCst), 1);
        assert_eq!(agent.renewals.load(Ordering::SeqCst), 0);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn root_path_swap_before_commit_is_detected_and_never_provisions() {
        let container = temporary_directory();
        let root = container.join("root");
        let moved = container.join("moved-root");
        let outside = container.join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(&outside, fs::Permissions::from_mode(0o700)).unwrap();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());

        assert_eq!(
            manager.replace_with_hook(input("account-a", 1), |stage| {
                if stage == ReplaceStage::AfterTempSync {
                    fs::rename(&root, &moved).unwrap();
                    std::os::unix::fs::symlink(&outside, &root).unwrap();
                }
                Ok(())
            }),
            Err(ProjectionError::Io)
        );
        assert_eq!(agent.provisions.lock().unwrap().len(), 0);
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
        fs::remove_file(&root).unwrap();
        fs::rename(&moved, &root).unwrap();
        fs::remove_dir_all(container).unwrap();
    }

    #[test]
    fn temp_creation_is_0600_and_rejects_symlink_hardlink_or_directory() {
        let root = temporary_directory();
        let directory = SecureDirectory::open(&root).unwrap();
        let outside = root
            .parent()
            .unwrap()
            .join(format!("outside-{}", uuid::Uuid::new_v4()));
        fs::write(&outside, b"outside").unwrap();
        fs::set_permissions(&outside, fs::Permissions::from_mode(0o600)).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("symlink.tmp")).unwrap();
        fs::hard_link(&outside, root.join("hardlink.tmp")).unwrap();
        fs::create_dir(root.join("directory.tmp")).unwrap();

        assert!(matches!(
            directory.create_file("symlink.tmp"),
            Err(ProjectionError::Io)
        ));
        assert!(matches!(
            directory.create_file("hardlink.tmp"),
            Err(ProjectionError::Io)
        ));
        assert!(matches!(
            directory.create_file("directory.tmp"),
            Err(ProjectionError::Io)
        ));
        let secure = directory.create_file("secure.tmp").unwrap();
        assert_eq!(secure.metadata().unwrap().mode() & 0o777, 0o600);
        drop(secure);
        assert!(!secure_file_stat(libc::S_IFREG | 0o600, 99, 1, 100));
        assert!(!secure_file_stat(libc::S_IFDIR | 0o600, 100, 1, 100));
        fs::remove_dir_all(root).unwrap();
        fs::remove_file(outside).unwrap();
    }

    #[test]
    fn logout_clear_deletes_only_the_requested_account_projection() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent);
        let current = manager.replace(input("account-a", 1)).unwrap();

        manager.clear("account-b").unwrap();
        assert!(current.path.exists());
        manager.clear("account-a").unwrap();
        assert!(!current.path.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
