use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::Duration,
};

#[cfg(test)]
use std::sync::TryLockError;

const CLIPBOARD_UNAVAILABLE: &str = "clipboard unavailable";

#[derive(Clone)]
pub struct ClipboardGeneration {
    current: Arc<AtomicU64>,
    operation_lock: Arc<Mutex<()>>,
    #[cfg(test)]
    operation_contention_hook: Arc<Mutex<Option<std::sync::mpsc::Sender<()>>>>,
}

impl Default for ClipboardGeneration {
    fn default() -> Self {
        Self {
            current: Arc::new(AtomicU64::new(0)),
            operation_lock: Arc::new(Mutex::new(())),
            #[cfg(test)]
            operation_contention_hook: Arc::new(Mutex::new(None)),
        }
    }
}

impl ClipboardGeneration {
    pub fn next(&self) -> Option<u64> {
        let mut current = self.current.load(Ordering::Acquire);

        loop {
            if current == u64::MAX {
                return None;
            }

            let next = current + 1;
            match self.current.compare_exchange_weak(
                current,
                next,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return (next != u64::MAX).then_some(next),
                Err(observed) => current = observed,
            }
        }
    }

    pub fn is_current(&self, generation: u64) -> bool {
        generation != u64::MAX && self.current.load(Ordering::Acquire) == generation
    }

    pub(crate) fn lock_operation(&self) -> Result<MutexGuard<'_, ()>, String> {
        #[cfg(test)]
        match self.operation_lock.try_lock() {
            Ok(operation) => return Ok(operation),
            Err(TryLockError::WouldBlock) => self.notify_operation_contention(),
            Err(TryLockError::Poisoned(_)) => return Err(CLIPBOARD_UNAVAILABLE.to_owned()),
        }

        self.operation_lock
            .lock()
            .map_err(|_| CLIPBOARD_UNAVAILABLE.to_owned())
    }

    #[cfg(test)]
    fn install_operation_contention_hook(&self) -> std::sync::mpsc::Receiver<()> {
        let (sender, receiver) = std::sync::mpsc::channel();
        *self
            .operation_contention_hook
            .lock()
            .expect("operation contention hook lock") = Some(sender);
        receiver
    }

    #[cfg(test)]
    fn notify_operation_contention(&self) {
        if let Some(sender) = self
            .operation_contention_hook
            .lock()
            .expect("operation contention hook lock")
            .take()
        {
            let _ = sender.send(());
        }
    }

    #[cfg(test)]
    fn from_current_for_test(current: u64) -> Self {
        Self {
            current: Arc::new(AtomicU64::new(current)),
            operation_lock: Arc::new(Mutex::new(())),
            operation_contention_hook: Arc::new(Mutex::new(None)),
        }
    }
}

pub trait ClipboardAccess: Clone + Send + Sync + 'static {
    fn set_text(&self, value: &str) -> Result<(), String>;
    fn get_text(&self) -> Result<String, String>;
}

#[derive(Clone, Copy)]
struct SystemClipboard;

impl ClipboardAccess for SystemClipboard {
    fn set_text(&self, value: &str) -> Result<(), String> {
        let mut clipboard =
            arboard::Clipboard::new().map_err(|_| CLIPBOARD_UNAVAILABLE.to_owned())?;
        clipboard
            .set_text(value.to_owned())
            .map_err(|_| CLIPBOARD_UNAVAILABLE.to_owned())
    }

    fn get_text(&self) -> Result<String, String> {
        let mut clipboard =
            arboard::Clipboard::new().map_err(|_| CLIPBOARD_UNAVAILABLE.to_owned())?;
        clipboard
            .get_text()
            .map_err(|_| CLIPBOARD_UNAVAILABLE.to_owned())
    }
}

#[tauri::command]
pub async fn copy_text(
    generations: tauri::State<'_, ClipboardGeneration>,
    value: String,
    clear_after_seconds: Option<u64>,
) -> Result<(), String> {
    copy_text_with_app_generation(generations.inner().clone(), value, clear_after_seconds).await
}

pub async fn copy_text_with_app_generation(
    generations: ClipboardGeneration,
    value: String,
    clear_after_seconds: Option<u64>,
) -> Result<(), String> {
    copy_text_with_generation(SystemClipboard, generations, value, clear_after_seconds).await
}

#[cfg(test)]
pub async fn copy_text_with<C>(
    clipboard: C,
    value: String,
    clear_after_seconds: Option<u64>,
) -> Result<(), String>
where
    C: ClipboardAccess,
{
    copy_text_with_generation(
        clipboard,
        ClipboardGeneration::default(),
        value,
        clear_after_seconds,
    )
    .await
}

pub async fn copy_text_with_generation<C>(
    clipboard: C,
    generations: ClipboardGeneration,
    value: String,
    clear_after_seconds: Option<u64>,
) -> Result<(), String>
where
    C: ClipboardAccess,
{
    validate_clipboard_value(&value)?;
    let generation = {
        let _operation = generations.lock_operation()?;
        clipboard
            .set_text(&value)
            .map_err(|_| CLIPBOARD_UNAVAILABLE.to_owned())?;
        generations.next()
    };

    if let (Some(generation), Some(seconds)) = (
        generation,
        clear_after_seconds.filter(|seconds| should_schedule_clear(Some(*seconds))),
    ) {
        let clipboard_for_clear = clipboard.clone();
        let value_for_clear = value.clone();
        let generations_for_clear = generations.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(seconds)).await;
            let _ = clear_if_current(
                &clipboard_for_clear,
                &generations_for_clear,
                generation,
                &value_for_clear,
            );
        });
    }

    Ok(())
}

fn validate_clipboard_value(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err("clipboard value cannot be empty".to_owned());
    }

    Ok(())
}

fn should_schedule_clear(clear_after_seconds: Option<u64>) -> bool {
    matches!(clear_after_seconds, Some(seconds) if seconds > 0)
}

fn clear_if_current<C>(
    clipboard: &C,
    generations: &ClipboardGeneration,
    generation: u64,
    expected_value: &str,
) -> Result<(), String>
where
    C: ClipboardAccess,
{
    let _operation = generations.lock_operation()?;
    let current_value = clipboard
        .get_text()
        .map_err(|_| CLIPBOARD_UNAVAILABLE.to_owned())?;

    if should_clear_clipboard(generations, generation, Ok(current_value), expected_value) {
        clipboard
            .set_text("")
            .map_err(|_| CLIPBOARD_UNAVAILABLE.to_owned())?;
    }

    Ok(())
}

fn should_clear_clipboard(
    generations: &ClipboardGeneration,
    generation: u64,
    current_value: Result<String, String>,
    expected_value: &str,
) -> bool {
    generations.is_current(generation)
        && matches!(current_value, Ok(value) if value == expected_value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicBool, mpsc, Arc, Mutex};

    #[derive(Clone, Default)]
    struct MemoryClipboard {
        value: Arc<Mutex<String>>,
    }

    impl MemoryClipboard {
        fn current_value(&self) -> String {
            self.value.lock().expect("clipboard lock").clone()
        }
    }

    impl ClipboardAccess for MemoryClipboard {
        fn set_text(&self, value: &str) -> Result<(), String> {
            *self.value.lock().expect("clipboard lock") = value.to_owned();
            Ok(())
        }

        fn get_text(&self) -> Result<String, String> {
            Ok(self.current_value())
        }
    }

    #[tokio::test]
    async fn accepts_non_empty_clipboard_value() {
        let clipboard = MemoryClipboard::default();

        copy_text_with(clipboard.clone(), "secret".to_owned(), None)
            .await
            .expect("copy should succeed");

        assert_eq!(clipboard.current_value(), "secret");
    }

    #[tokio::test]
    async fn rejects_empty_clipboard_value() {
        let result = copy_text_with(MemoryClipboard::default(), String::new(), None).await;

        assert_eq!(result, Err("clipboard value cannot be empty".to_owned()));
    }

    #[test]
    fn zero_and_missing_timeouts_do_not_schedule_a_clear() {
        assert!(!should_schedule_clear(None));
        assert!(!should_schedule_clear(Some(0)));
        assert!(should_schedule_clear(Some(10)));
    }

    #[tokio::test]
    async fn zero_timeout_copy_invalidates_an_older_clear_timer() {
        let clipboard = MemoryClipboard::default();
        let generations = ClipboardGeneration::default();
        let generation_a = generations.next().expect("generation A should be active");

        copy_text_with_generation(
            clipboard.clone(),
            generations.clone(),
            "secret".to_owned(),
            Some(0),
        )
        .await
        .expect("zero-timeout copy should succeed");
        clear_if_current(&clipboard, &generations, generation_a, "secret")
            .expect("A clear decision should complete");

        assert_eq!(clipboard.current_value(), "secret");
    }

    #[tokio::test]
    async fn missing_timeout_copy_invalidates_an_older_clear_timer() {
        let clipboard = MemoryClipboard::default();
        let generations = ClipboardGeneration::default();
        let generation_a = generations.next().expect("generation A should be active");

        copy_text_with_generation(
            clipboard.clone(),
            generations.clone(),
            "secret".to_owned(),
            None,
        )
        .await
        .expect("missing-timeout copy should succeed");
        clear_if_current(&clipboard, &generations, generation_a, "secret")
            .expect("A clear decision should complete");

        assert_eq!(clipboard.current_value(), "secret");
    }

    #[tokio::test]
    async fn a_clear_cannot_read_or_clear_during_b_copy_generation_transition() {
        #[derive(Clone)]
        struct BlockingClipboard {
            value: Arc<Mutex<String>>,
            block_next_write: Arc<AtomicBool>,
            b_written: Arc<Mutex<Option<mpsc::Sender<()>>>>,
            release_b: Arc<Mutex<Option<mpsc::Receiver<()>>>>,
        }

        impl ClipboardAccess for BlockingClipboard {
            fn set_text(&self, value: &str) -> Result<(), String> {
                *self.value.lock().expect("clipboard lock") = value.to_owned();

                if self.block_next_write.swap(false, Ordering::AcqRel) {
                    self.b_written
                        .lock()
                        .expect("B written sender")
                        .take()
                        .expect("B written sender should exist")
                        .send(())
                        .expect("notify B write");
                    self.release_b
                        .lock()
                        .expect("B release receiver")
                        .take()
                        .expect("B release receiver should exist")
                        .recv()
                        .expect("release B write");
                }

                Ok(())
            }

            fn get_text(&self) -> Result<String, String> {
                Ok(self.value.lock().expect("clipboard lock").clone())
            }
        }

        let (b_written_sender, b_written_receiver) = mpsc::channel();
        let (release_b_sender, release_b_receiver) = mpsc::channel();
        let clipboard = BlockingClipboard {
            value: Arc::new(Mutex::new(String::new())),
            block_next_write: Arc::new(AtomicBool::new(false)),
            b_written: Arc::new(Mutex::new(Some(b_written_sender))),
            release_b: Arc::new(Mutex::new(Some(release_b_receiver))),
        };
        let generations = ClipboardGeneration::default();

        copy_text_with_generation(
            clipboard.clone(),
            generations.clone(),
            "secret".to_owned(),
            None,
        )
        .await
        .expect("A copy should succeed");
        let generation_a = generations.current.load(Ordering::Acquire);
        clipboard.block_next_write.store(true, Ordering::Release);

        let clipboard_for_b = clipboard.clone();
        let generations_for_b = generations.clone();
        let b_copy = std::thread::spawn(move || {
            tauri::async_runtime::block_on(copy_text_with_generation(
                clipboard_for_b,
                generations_for_b,
                "secret".to_owned(),
                None,
            ))
        });
        let b_written = b_written_receiver
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "B did not reach its blocked write");
        let mut a_clear = None;
        let contention = if b_written.is_ok() {
            let contention_receiver = generations.install_operation_contention_hook();
            let clipboard_for_a = clipboard.clone();
            let generations_for_a = generations.clone();
            a_clear = Some(std::thread::spawn(move || {
                clear_if_current(&clipboard_for_a, &generations_for_a, generation_a, "secret")
            }));
            contention_receiver
                .recv_timeout(Duration::from_secs(2))
                .map_err(|_| "A clear did not observe the B-held operation lock".to_owned())
        } else {
            Err("B did not hold the operation lock".to_owned())
        };

        let _ = release_b_sender.send(());
        let b_result = b_copy.join();
        let a_result = a_clear.map(|thread| thread.join());

        assert_eq!(b_written, Ok(()));
        assert_eq!(contention, Ok(()));
        assert!(matches!(b_result, Ok(Ok(()))));
        assert!(matches!(a_result, Some(Ok(Ok(())))));
        assert_eq!(
            clipboard.value.lock().expect("clipboard lock").as_str(),
            "secret"
        );
        assert!(!generations.is_current(generation_a));
    }

    #[tokio::test]
    async fn failed_replacement_copy_keeps_the_old_generation_current() {
        #[derive(Clone)]
        struct FailingReplacementClipboard {
            value: Arc<Mutex<String>>,
            fail_next_write: Arc<Mutex<bool>>,
        }

        impl ClipboardAccess for FailingReplacementClipboard {
            fn set_text(&self, value: &str) -> Result<(), String> {
                let mut fail_next_write = self.fail_next_write.lock().expect("failure lock");
                if *fail_next_write {
                    *fail_next_write = false;
                    return Err("private pasteboard failure".to_owned());
                }
                *self.value.lock().expect("clipboard lock") = value.to_owned();
                Ok(())
            }

            fn get_text(&self) -> Result<String, String> {
                Ok(self.value.lock().expect("clipboard lock").clone())
            }
        }

        let clipboard = FailingReplacementClipboard {
            value: Arc::new(Mutex::new("old-secret".to_owned())),
            fail_next_write: Arc::new(Mutex::new(true)),
        };
        let generations = ClipboardGeneration::default();
        let generation_a = generations.next().expect("generation A should be active");

        let result = copy_text_with_generation(
            clipboard.clone(),
            generations.clone(),
            "replacement".to_owned(),
            None,
        )
        .await;

        assert_eq!(result, Err("clipboard unavailable".to_owned()));
        assert!(generations.is_current(generation_a));
        clear_if_current(&clipboard, &generations, generation_a, "old-secret")
            .expect("old timer should still clear its value");
        assert_eq!(clipboard.value.lock().expect("clipboard lock").as_str(), "");
    }

    #[test]
    fn changed_clipboard_value_survives_clear_decision() {
        let clipboard = MemoryClipboard::default();
        let generations = ClipboardGeneration::default();
        let generation = generations.next().expect("generation should be active");

        clipboard.set_text("changed").expect("set changed value");
        clear_if_current(&clipboard, &generations, generation, "secret")
            .expect("clear decision should complete");

        assert_eq!(clipboard.current_value(), "changed");
    }

    #[test]
    fn timer_for_a_does_not_clear_newer_identical_generation_b() {
        let clipboard = MemoryClipboard::default();
        let generations = ClipboardGeneration::default();
        let generation_a = generations.next().expect("generation A should be active");
        let generation_b = generations.next().expect("generation B should be active");

        assert_ne!(generation_a, generation_b);
        clipboard.set_text("secret").expect("set B value");
        clear_if_current(&clipboard, &generations, generation_a, "secret")
            .expect("A clear decision should complete");
        assert_eq!(clipboard.current_value(), "secret");

        clear_if_current(&clipboard, &generations, generation_b, "secret")
            .expect("B clear decision should complete");
        assert_eq!(clipboard.current_value(), "");
    }

    #[test]
    fn reaching_maximum_disables_future_clears_without_reactivating_old_timers() {
        let generations = ClipboardGeneration::from_current_for_test(u64::MAX - 2);
        let last_active = generations.next().expect("last active generation");

        assert_eq!(last_active, u64::MAX - 1);
        assert_eq!(generations.next(), None);
        assert_eq!(generations.next(), None);
        assert!(!generations.is_current(last_active));
    }

    #[tokio::test]
    async fn sanitizes_clipboard_access_errors() {
        #[derive(Clone)]
        struct FailingClipboard;

        impl ClipboardAccess for FailingClipboard {
            fn set_text(&self, _value: &str) -> Result<(), String> {
                Err("private pasteboard value and platform error".to_owned())
            }

            fn get_text(&self) -> Result<String, String> {
                Err("private pasteboard value and platform error".to_owned())
            }
        }

        let result = copy_text_with(FailingClipboard, "secret".to_owned(), None).await;

        assert_eq!(result, Err("clipboard unavailable".to_owned()));
    }
}
