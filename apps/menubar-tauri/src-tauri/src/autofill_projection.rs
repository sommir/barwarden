use crate::autofill_contract::{AgentErrorCode, AgentOperation, AgentRequest};
use crate::autofill_ipc::AgentClient;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::ffi::CString;
use std::fs::{self, File};
use std::io::Write;
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Zeroize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoFillUri {
    pub uri: String,
    pub match_type: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Zeroize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoFillLogin {
    pub cipher_id: String,
    pub name: String,
    pub username: String,
    pub password: String,
    pub uris: Vec<AutoFillUri>,
    pub totp: String,
    pub favorite: bool,
    pub reprompt: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Zeroize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoFillProjectionInput {
    pub account_id: String,
    pub created_at: String,
    pub logins: Vec<AutoFillLogin>,
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
}

impl AutoFillProjection {
    fn take_from_input(input: &mut AutoFillProjectionInput, vault_revision: u64) -> Self {
        Self {
            version: FORMAT_VERSION,
            account_id: std::mem::take(&mut input.account_id),
            vault_revision,
            created_at: std::mem::take(&mut input.created_at),
            logins: std::mem::take(&mut input.logins),
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
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectionReceipt {
    pub path: PathBuf,
    pub generation: String,
    pub vault_revision: u64,
}

struct ProjectionState {
    account_id: String,
    generation: String,
    vault_revision: u64,
    key: [u8; KEY_BYTES],
    path: PathBuf,
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
        }
    }

    pub fn replace(
        &self,
        input: AutoFillProjectionInput,
    ) -> Result<ProjectionReceipt, ProjectionError> {
        self.replace_with_hook(input, |_| Ok(()))
    }

    fn replace_with_hook(
        &self,
        mut input: AutoFillProjectionInput,
        mut stage_hook: impl FnMut(ReplaceStage) -> Result<(), ProjectionError>,
    ) -> Result<ProjectionReceipt, ProjectionError> {
        validate_input(&input)?;
        let directory = SecureDirectory::open(&self.root)?;
        let mut state = self.state.lock().map_err(|_| ProjectionError::Io)?;
        if self.pending_lock.load(Ordering::SeqCst) {
            self.agent.lock()?;
            if let Some(previous) = state.take() {
                self.remember_cleanup(previous.path.clone());
            }
            self.pending_lock.store(false, Ordering::SeqCst);
        }
        self.retry_pending_cleanup(&directory, &mut stage_hook)?;
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

        let (generation, key) = if same_account {
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
            let _ = directory.remove(&temp_name);
            let _ = directory.sync();
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
                self.pending_lock.store(true, Ordering::SeqCst);
                if self.agent.lock().is_ok() {
                    if let Some(previous) = state.take() {
                        self.remember_cleanup(previous.path.clone());
                    }
                    self.pending_lock.store(false, Ordering::SeqCst);
                }
            }
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
            let rollback = (|| {
                directory.remove(&final_name)?;
                if had_final {
                    directory.rename(&backup_name, &final_name)?;
                }
                directory.sync()
            })();
            self.pending_lock.store(true, Ordering::SeqCst);
            if self.agent.lock().is_ok() {
                if let Some(previous) = state.take() {
                    self.remember_cleanup(previous.path.clone());
                }
                self.pending_lock.store(false, Ordering::SeqCst);
            }
            return Err(rollback.err().unwrap_or(error));
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
        if stage_hook(ReplaceStage::BeforeCleanupRemove).is_ok() {
            let _ = self.retry_pending_cleanup(&directory, &mut stage_hook);
        }
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
        if account_id.is_empty() {
            return Err(ProjectionError::InvalidInput);
        }
        let mut state = self.state.lock().map_err(|_| ProjectionError::Io)?;
        let directory = SecureDirectory::open(&self.root)?;
        let name = projection_file_name(account_id);
        let is_active = state
            .as_ref()
            .is_some_and(|current| current.account_id == account_id);
        if is_active {
            self.pending_lock.store(true, Ordering::SeqCst);
        }
        let disk_result = (|| {
            if directory.remove(&name)? {
                directory.sync()?;
            }
            Ok(())
        })();
        if is_active {
            let lock_result = self.agent.lock();
            if lock_result.is_err() {
                return lock_result;
            }
            if let Some(previous) = state.take() {
                if previous.path != directory.path(&name) {
                    self.remember_cleanup(previous.path.clone());
                }
            }
            self.pending_lock.store(false, Ordering::SeqCst);
        }
        disk_result
    }

    pub fn lock(&self) -> Result<(), ProjectionError> {
        let mut state = self.state.lock().map_err(|_| ProjectionError::Io)?;
        self.pending_lock.store(true, Ordering::SeqCst);
        let disk_result = if let Some(current) = state.as_ref() {
            (|| {
                let directory = SecureDirectory::open(&self.root)?;
                let name = current
                    .path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or(ProjectionError::Io)?;
                if directory.remove(name)? {
                    directory.sync()?;
                }
                Ok(())
            })()
        } else {
            Ok(())
        };
        self.agent.lock()?;
        if let Some(previous) = state.take() {
            self.remember_cleanup(previous.path.clone());
        }
        self.pending_lock.store(false, Ordering::SeqCst);
        disk_result
    }

    pub fn renew_lease(&self) -> Result<(), ProjectionError> {
        let mut state = self.state.lock().map_err(|_| ProjectionError::Io)?;
        if self.pending_lock.load(Ordering::SeqCst) {
            self.agent.lock()?;
            if let Some(previous) = state.take() {
                self.remember_cleanup(previous.path.clone());
            }
            self.pending_lock.store(false, Ordering::SeqCst);
        }
        let directory = SecureDirectory::open(&self.root)?;
        self.retry_pending_cleanup(&directory, &mut |_| Ok(()))?;
        if let Some(current) = state.as_ref() {
            self.agent
                .renew(&current.generation, &current.account_id, 30)?;
        }
        Ok(())
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
    let home = std::env::var_os("HOME").ok_or(ProjectionError::Io)?;
    let root = Path::new(&home)
        .join("Library/Group Containers")
        .join("group.com.sommir.barwarden.autofill");
    let manager = std::sync::Arc::new(ProjectionManager::new(
        root,
        std::sync::Arc::new(IpcProjectionAgent),
    ));
    let weak = std::sync::Arc::downgrade(&manager);
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(10));
        let Some(manager) = weak.upgrade() else { break };
        let _ = manager.renew_lease();
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
    }
}

#[tauri::command]
pub fn autofill_replace_projection(
    manager: tauri::State<'_, std::sync::Arc<SystemProjectionManager>>,
    input: AutoFillProjectionInput,
) -> Result<u64, &'static str> {
    manager
        .replace(input)
        .map(|receipt| receipt.vault_revision)
        .map_err(command_error)
}

#[tauri::command]
pub fn autofill_clear_projection(
    manager: tauri::State<'_, std::sync::Arc<SystemProjectionManager>>,
    account_id: String,
) -> Result<(), &'static str> {
    manager.clear(&account_id).map_err(command_error)
}

#[tauri::command]
pub fn autofill_lock_projection(
    manager: tauri::State<'_, std::sync::Arc<SystemProjectionManager>>,
) -> Result<(), &'static str> {
    manager.lock().map_err(command_error)
}

fn validate_input(input: &AutoFillProjectionInput) -> Result<(), ProjectionError> {
    if input.account_id.is_empty()
        || input.created_at.is_empty()
        || input.logins.iter().any(|login| login.cipher_id.is_empty())
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

    #[derive(Default)]
    struct RecordingAgent {
        provisions: Mutex<Vec<ProjectionProvision>>,
        fail: AtomicBool,
        fail_lock: AtomicBool,
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
                username: "fixture-user@example.test".to_owned(),
                password: "fixture-password-value".to_owned(),
                uris: vec![AutoFillUri {
                    uri: "https://fixture.example.test/login".to_owned(),
                    match_type: "default".to_owned(),
                }],
                totp: "JBSWY3DPEHPK3PXP".to_owned(),
                favorite: true,
                reprompt: false,
            }],
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
    fn failed_lock_retains_pending_state_stops_renewal_and_retries_to_acknowledgement() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let receipt = manager.replace(input("account-a", 1)).unwrap();
        agent.fail_lock.store(true, Ordering::SeqCst);

        assert_eq!(manager.lock(), Err(ProjectionError::AgentUnavailable));
        assert!(manager.state.lock().unwrap().is_some());
        assert!(
            !receipt.path.exists(),
            "deleting the ciphertext revokes reads even before IPC recovers"
        );
        assert_eq!(
            manager.renew_lease(),
            Err(ProjectionError::AgentUnavailable)
        );
        assert_eq!(agent.renewals.load(Ordering::SeqCst), 0);

        agent.fail_lock.store(false, Ordering::SeqCst);
        manager.renew_lease().unwrap();
        assert!(manager.state.lock().unwrap().is_none());
        assert_eq!(agent.locks.load(Ordering::SeqCst), 3);
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
    fn failed_reprovision_drops_the_old_lease_and_locks_the_agent() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent.clone());
        let current = manager.replace(input("account-a", 1)).unwrap();
        agent.fail.store(true, Ordering::SeqCst);

        assert_eq!(
            manager.replace(input("account-a", 2)),
            Err(ProjectionError::AgentUnavailable),
        );
        assert!(current.path.exists());
        let provisions = agent.provisions.lock().unwrap();
        let restored =
            decrypt_projection(&fs::read(&current.path).unwrap(), &provisions[0].key).unwrap();
        assert_eq!(restored.vault_revision, 1);
        drop(provisions);
        assert!(manager.state.lock().unwrap().is_none());
        assert_eq!(agent.locks.load(Ordering::SeqCst), 1);
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

        let current = manager
            .replace_with_hook(input("account-b", 1), |stage| {
                if stage == ReplaceStage::BeforeCleanupRemove {
                    Err(ProjectionError::Io)
                } else {
                    Ok(())
                }
            })
            .unwrap();

        assert!(previous.path.exists());
        assert!(current.path.exists());
        assert_eq!(
            manager.state.lock().unwrap().as_ref().unwrap().account_id,
            "account-b"
        );
        assert_eq!(
            agent.provisions.lock().unwrap().last().unwrap().account_id,
            "account-b"
        );
        manager.renew_lease().unwrap();
        assert!(!previous.path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_directory_sync_fault_is_recorded_and_retried() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent);
        manager.replace(input("account-a", 1)).unwrap();

        let receipt = manager
            .replace_with_hook(input("account-b", 1), |stage| {
                if stage == ReplaceStage::BeforeCleanupDirectorySync {
                    Err(ProjectionError::Io)
                } else {
                    Ok(())
                }
            })
            .unwrap();

        assert!(receipt.path.exists());
        assert!(manager.pending_directory_sync.load(Ordering::SeqCst));
        manager.renew_lease().unwrap();
        assert!(!manager.pending_directory_sync.load(Ordering::SeqCst));
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
