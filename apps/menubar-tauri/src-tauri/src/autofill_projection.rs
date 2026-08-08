use crate::autofill_contract::{AgentErrorCode, AgentOperation, AgentRequest};
use crate::autofill_ipc::AgentClient;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoFillProjectionInput {
    pub account_id: String,
    pub vault_revision: u64,
    pub created_at: String,
    pub logins: Vec<AutoFillLogin>,
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

impl From<AutoFillProjectionInput> for AutoFillProjection {
    fn from(input: AutoFillProjectionInput) -> Self {
        Self {
            version: FORMAT_VERSION,
            account_id: input.account_id,
            vault_revision: input.vault_revision,
            created_at: input.created_at,
            logins: input.logins,
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

impl Drop for ProjectionState {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

pub struct ProjectionManager<A: ProjectionAgent> {
    root: PathBuf,
    agent: std::sync::Arc<A>,
    state: Mutex<Option<ProjectionState>>,
}

impl<A: ProjectionAgent> ProjectionManager<A> {
    pub fn new(root: PathBuf, agent: std::sync::Arc<A>) -> Self {
        Self {
            root,
            agent,
            state: Mutex::new(None),
        }
    }

    pub fn replace(
        &self,
        input: AutoFillProjectionInput,
    ) -> Result<ProjectionReceipt, ProjectionError> {
        self.replace_with_hook(input, || Ok(()))
    }

    fn replace_with_hook(
        &self,
        input: AutoFillProjectionInput,
        after_temp_sync: impl FnOnce() -> Result<(), ProjectionError>,
    ) -> Result<ProjectionReceipt, ProjectionError> {
        validate_input(&input)?;
        fs::create_dir_all(&self.root).map_err(|_| ProjectionError::Io)?;
        let mut state = self.state.lock().map_err(|_| ProjectionError::Io)?;
        let same_account = state
            .as_ref()
            .is_some_and(|current| current.account_id == input.account_id);
        if same_account && input.vault_revision <= state.as_ref().unwrap().vault_revision {
            return Err(ProjectionError::StaleRevision);
        }

        let (generation, key) = if same_account {
            let current = state.as_ref().unwrap();
            (current.generation.clone(), Zeroizing::new(current.key))
        } else {
            let mut key = [0_u8; KEY_BYTES];
            rand::rng().fill_bytes(&mut key);
            (uuid::Uuid::new_v4().to_string(), Zeroizing::new(key))
        };
        let account_id = input.account_id.clone();
        let vault_revision = input.vault_revision;
        let mut projection = AutoFillProjection::from(input);
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
        let final_path = projection_path(&self.root, &account_id);
        let temp_path = self
            .root
            .join(format!(".projection-{}.tmp", uuid::Uuid::new_v4()));

        let write_result = (|| {
            let mut temp = OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&temp_path)
                .map_err(|_| ProjectionError::Io)?;
            temp.write_all(&encrypted)
                .map_err(|_| ProjectionError::Io)?;
            temp.sync_all().map_err(|_| ProjectionError::Io)?;
            after_temp_sync()?;
            fs::rename(&temp_path, &final_path).map_err(|_| ProjectionError::Io)?;
            sync_directory(&self.root)?;
            Ok(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temp_path);
            return write_result.map(|_| unreachable!());
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
            let _ = fs::remove_file(&final_path);
            let _ = sync_directory(&self.root);
            *state = None;
            let _ = self.agent.lock();
            return Err(error);
        }

        if let Some(previous) = state.as_ref() {
            if previous.path != final_path {
                fs::remove_file(&previous.path).map_err(|_| ProjectionError::Io)?;
                sync_directory(&self.root)?;
            }
        }
        *state = Some(ProjectionState {
            account_id,
            generation: generation.clone(),
            vault_revision,
            key: *key,
            path: final_path.clone(),
        });
        Ok(ProjectionReceipt {
            path: final_path,
            generation,
            vault_revision,
        })
    }

    pub fn clear(&self, account_id: &str) -> Result<(), ProjectionError> {
        if account_id.is_empty() {
            return Err(ProjectionError::InvalidInput);
        }
        let mut state = self.state.lock().map_err(|_| ProjectionError::Io)?;
        let path = projection_path(&self.root, account_id);
        if path.exists() {
            fs::remove_file(&path).map_err(|_| ProjectionError::Io)?;
            sync_directory(&self.root)?;
        }
        if state
            .as_ref()
            .is_some_and(|current| current.account_id == account_id)
        {
            *state = None;
            self.agent.lock()?;
        }
        Ok(())
    }

    pub fn lock(&self) -> Result<(), ProjectionError> {
        *self.state.lock().map_err(|_| ProjectionError::Io)? = None;
        self.agent.lock()
    }

    pub fn renew_lease(&self) -> Result<(), ProjectionError> {
        let state = self.state.lock().map_err(|_| ProjectionError::Io)?;
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
        self.replace_with_hook(input, || Err(ProjectionError::Interrupted))
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
) -> Result<(), &'static str> {
    manager.replace(input).map(|_| ()).map_err(command_error)
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
        || input.vault_revision == 0
        || input.created_at.is_empty()
        || input.logins.iter().any(|login| login.cipher_id.is_empty())
    {
        return Err(ProjectionError::InvalidInput);
    }
    Ok(())
}

fn projection_path(root: &Path, account_id: &str) -> PathBuf {
    let digest = Sha256::digest(account_id.as_bytes());
    root.join(format!("projection-{digest:x}.bwaf"))
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

fn sync_directory(path: &Path) -> Result<(), ProjectionError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| ProjectionError::Io)
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
        locks: AtomicUsize,
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
            Ok(())
        }

        fn renew(
            &self,
            _generation: &str,
            _account_id: &str,
            _lease_seconds: u64,
        ) -> Result<(), ProjectionError> {
            Ok(())
        }
    }

    fn input(account_id: &str, revision: u64) -> AutoFillProjectionInput {
        AutoFillProjectionInput {
            account_id: account_id.to_owned(),
            vault_revision: revision,
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
        assert_eq!(decoded.vault_revision, 7);
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
    fn stale_revision_never_replaces_current_projection() {
        let root = temporary_directory();
        let agent = Arc::new(RecordingAgent::default());
        let manager = ProjectionManager::new(root.clone(), agent);
        let current = manager.replace(input("account-a", 9)).unwrap();
        let before = fs::read(&current.path).unwrap();

        assert_eq!(
            manager.replace(input("account-a", 8)),
            Err(ProjectionError::StaleRevision)
        );
        assert_eq!(fs::read(current.path).unwrap(), before);
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
        assert!(!current.path.exists());
        assert!(manager.state.lock().unwrap().is_none());
        assert_eq!(agent.locks.load(Ordering::SeqCst), 1);
        fs::remove_dir_all(root).unwrap();
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
