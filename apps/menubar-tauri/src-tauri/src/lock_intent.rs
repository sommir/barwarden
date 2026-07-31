use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;

const LOCK_INTENTS_FILE_NAME: &str = "account-lock-intents.json";
const LOCK_INTENT_ERROR: &str = "account lock state unavailable";
static LOCK_INTENT_FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LockIntentState {
    locked_account_ids: BTreeSet<String>,
}

#[tauri::command]
pub async fn get_account_lock_intents(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| LOCK_INTENT_ERROR.to_owned())?;
    tauri::async_runtime::spawn_blocking(move || get_account_lock_intents_at(&root))
        .await
        .map_err(|_| LOCK_INTENT_ERROR.to_owned())?
}

#[tauri::command]
pub async fn set_account_lock_intents(
    app: tauri::AppHandle,
    account_ids: Vec<String>,
    locked: bool,
) -> Result<(), String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| LOCK_INTENT_ERROR.to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        set_account_lock_intents_at(&root, &account_ids, locked)
    })
    .await
    .map_err(|_| LOCK_INTENT_ERROR.to_owned())?
}

fn get_account_lock_intents_at(root: &Path) -> Result<Vec<String>, String> {
    let _guard = LOCK_INTENT_FILE_LOCK
        .lock()
        .map_err(|_| LOCK_INTENT_ERROR.to_owned())?;
    Ok(read_state(root)?.locked_account_ids.into_iter().collect())
}

fn set_account_lock_intents_at(
    root: &Path,
    account_ids: &[String],
    locked: bool,
) -> Result<(), String> {
    for account_id in account_ids {
        validate_account_id(account_id)?;
    }
    let _guard = LOCK_INTENT_FILE_LOCK
        .lock()
        .map_err(|_| LOCK_INTENT_ERROR.to_owned())?;
    let mut state = read_state(root)?;
    for account_id in account_ids {
        if locked {
            state.locked_account_ids.insert(account_id.to_owned());
        } else {
            state.locked_account_ids.remove(account_id);
        }
    }
    write_state(root, &state, locked)
}

fn read_state(root: &Path) -> Result<LockIntentState, String> {
    let path = root.join(LOCK_INTENTS_FILE_NAME);
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| LOCK_INTENT_ERROR.to_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(LockIntentState::default())
        }
        Err(_) => Err(LOCK_INTENT_ERROR.to_owned()),
    }
}

fn write_state(
    root: &Path,
    state: &LockIntentState,
    require_directory_sync: bool,
) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|_| LOCK_INTENT_ERROR.to_owned())?;
    let target = root.join(LOCK_INTENTS_FILE_NAME);
    let temporary = root.join(format!(
        ".{LOCK_INTENTS_FILE_NAME}.{}.tmp",
        std::process::id(),
    ));
    let bytes = serde_json::to_vec(state).map_err(|_| LOCK_INTENT_ERROR.to_owned())?;
    let result = (|| {
        let mut file = File::create(&temporary).map_err(|_| LOCK_INTENT_ERROR.to_owned())?;
        file.write_all(&bytes)
            .map_err(|_| LOCK_INTENT_ERROR.to_owned())?;
        file.sync_all().map_err(|_| LOCK_INTENT_ERROR.to_owned())?;
        fs::rename(&temporary, &target).map_err(|_| LOCK_INTENT_ERROR.to_owned())?;
        let directory_sync = File::open(root).and_then(|directory| directory.sync_all());
        if require_directory_sync {
            directory_sync.map_err(|_| LOCK_INTENT_ERROR.to_owned())?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn validate_account_id(account_id: &str) -> Result<(), String> {
    if account_id.trim().is_empty() || account_id.len() > 512 {
        return Err(LOCK_INTENT_ERROR.to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_and_clears_account_lock_intents() {
        let root = std::env::temp_dir()
            .join(format!("barwarden-lock-intent-test-{}", std::process::id(),));
        let _ = std::fs::remove_dir_all(&root);

        set_account_lock_intents_at(
            &root,
            &["account-one".to_owned(), "account-two".to_owned()],
            true,
        )
        .expect("persist lock intent");
        assert_eq!(
            get_account_lock_intents_at(&root).expect("read lock intents"),
            vec!["account-one".to_owned(), "account-two".to_owned()],
        );

        set_account_lock_intents_at(&root, &["account-one".to_owned()], false)
            .expect("clear lock intent");
        assert_eq!(
            get_account_lock_intents_at(&root).expect("read cleared lock intents"),
            vec!["account-two".to_owned()],
        );
        std::fs::remove_dir_all(root).expect("remove lock intent fixture");
    }
}
