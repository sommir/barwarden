use std::{fs, path::PathBuf};

use objc2_service_management::{SMAppService, SMAppServiceStatus};
use tauri::Manager;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ServiceStatus {
    NotRegistered,
    Enabled,
    RequiresApproval,
    NotFound,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LoginItemError;

trait LoginItemBackend {
    fn status(&self) -> Result<ServiceStatus, LoginItemError>;
    fn register(&self) -> Result<(), LoginItemError>;
    fn unregister(&self) -> Result<(), LoginItemError>;
}

struct MainAppService;

impl MainAppService {
    fn service() -> objc2::rc::Retained<SMAppService> {
        // SAFETY: `mainAppService` is a class property with no arguments and
        // returns a retained ServiceManagement object for the current app.
        unsafe { SMAppService::mainAppService() }
    }
}

impl LoginItemBackend for MainAppService {
    fn status(&self) -> Result<ServiceStatus, LoginItemError> {
        // SAFETY: The retained `SMAppService` is valid for the duration of the
        // call and `status` has no pointer arguments.
        let status = unsafe { Self::service().status() };
        match status {
            SMAppServiceStatus::NotRegistered => Ok(ServiceStatus::NotRegistered),
            SMAppServiceStatus::Enabled => Ok(ServiceStatus::Enabled),
            SMAppServiceStatus::RequiresApproval => Ok(ServiceStatus::RequiresApproval),
            SMAppServiceStatus::NotFound => Ok(ServiceStatus::NotFound),
            _ => Err(LoginItemError),
        }
    }

    fn register(&self) -> Result<(), LoginItemError> {
        // SAFETY: The generated binding owns the NSError out parameter and
        // returns it as a retained Rust error value.
        unsafe { Self::service().registerAndReturnError() }.map_err(|_| LoginItemError)
    }

    fn unregister(&self) -> Result<(), LoginItemError> {
        // SAFETY: The generated binding owns the NSError out parameter and
        // returns it as a retained Rust error value.
        unsafe { Self::service().unregisterAndReturnError() }.map_err(|_| LoginItemError)
    }
}

struct LoginItemController<B> {
    backend: B,
    legacy_launch_agent: PathBuf,
}

impl<B: LoginItemBackend> LoginItemController<B> {
    fn new(backend: B, legacy_launch_agent: PathBuf) -> Self {
        Self {
            backend,
            legacy_launch_agent,
        }
    }

    fn is_enabled(&self) -> Result<bool, LoginItemError> {
        let status = self.backend.status()?;
        if self
            .legacy_launch_agent
            .try_exists()
            .map_err(|_| LoginItemError)?
        {
            if status == ServiceStatus::NotRegistered {
                self.backend.register()?;
                if self.backend.status()? != ServiceStatus::Enabled {
                    return Err(LoginItemError);
                }
            }
            self.remove_legacy_launch_agent()?;
        }

        match self.backend.status()? {
            ServiceStatus::Enabled => Ok(true),
            ServiceStatus::NotRegistered
            | ServiceStatus::RequiresApproval
            | ServiceStatus::NotFound => Ok(false),
        }
    }

    fn set_enabled(&self, enabled: bool) -> Result<bool, LoginItemError> {
        let status = self.backend.status()?;
        if enabled {
            match status {
                ServiceStatus::Enabled => {}
                ServiceStatus::NotRegistered | ServiceStatus::NotFound => {
                    self.backend.register()?;
                }
                ServiceStatus::RequiresApproval => return Err(LoginItemError),
            }
            if self.backend.status()? != ServiceStatus::Enabled {
                return Err(LoginItemError);
            }
            self.remove_legacy_launch_agent()?;
            return Ok(true);
        }

        match status {
            ServiceStatus::Enabled | ServiceStatus::RequiresApproval => {
                self.backend.unregister()?;
            }
            ServiceStatus::NotRegistered | ServiceStatus::NotFound => {}
        }
        self.remove_legacy_launch_agent()?;
        if matches!(
            self.backend.status()?,
            ServiceStatus::NotRegistered | ServiceStatus::NotFound
        ) {
            Ok(false)
        } else {
            Err(LoginItemError)
        }
    }

    fn remove_legacy_launch_agent(&self) -> Result<(), LoginItemError> {
        if self
            .legacy_launch_agent
            .try_exists()
            .map_err(|_| LoginItemError)?
        {
            fs::remove_file(&self.legacy_launch_agent).map_err(|_| LoginItemError)?;
        }
        Ok(())
    }
}

fn controller(
    app: &tauri::AppHandle,
) -> Result<LoginItemController<MainAppService>, LoginItemError> {
    let home = app.path().home_dir().map_err(|_| LoginItemError)?;
    Ok(LoginItemController::new(
        MainAppService,
        home.join("Library/LaunchAgents/Barwarden.plist"),
    ))
}

#[tauri::command]
pub(crate) fn get_launch_at_login(app: tauri::AppHandle) -> Result<bool, &'static str> {
    controller(&app)
        .and_then(|controller| controller.is_enabled())
        .map_err(|_| "login-item-unavailable")
}

#[tauri::command]
pub(crate) fn set_launch_at_login(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<bool, &'static str> {
    controller(&app)
        .and_then(|controller| controller.set_enabled(enabled))
        .map_err(|_| "login-item-unavailable")
}

#[cfg(test)]
mod tests {
    use std::{
        cell::Cell,
        fs,
        path::{Path, PathBuf},
        rc::Rc,
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::{LoginItemBackend, LoginItemController, LoginItemError, ServiceStatus};

    static NEXT_TEMP_DIR: AtomicU64 = AtomicU64::new(0);

    #[derive(Clone)]
    struct FakeBackend {
        status: Rc<Cell<ServiceStatus>>,
        register_calls: Rc<Cell<u32>>,
        unregister_calls: Rc<Cell<u32>>,
    }

    impl FakeBackend {
        fn new(status: ServiceStatus) -> Self {
            Self {
                status: Rc::new(Cell::new(status)),
                register_calls: Rc::new(Cell::new(0)),
                unregister_calls: Rc::new(Cell::new(0)),
            }
        }
    }

    impl LoginItemBackend for FakeBackend {
        fn status(&self) -> Result<ServiceStatus, LoginItemError> {
            Ok(self.status.get())
        }

        fn register(&self) -> Result<(), LoginItemError> {
            self.register_calls.set(self.register_calls.get() + 1);
            self.status.set(ServiceStatus::Enabled);
            Ok(())
        }

        fn unregister(&self) -> Result<(), LoginItemError> {
            self.unregister_calls.set(self.unregister_calls.get() + 1);
            self.status.set(ServiceStatus::NotRegistered);
            Ok(())
        }
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "barwarden-login-item-test-{}-{}",
                std::process::id(),
                NEXT_TEMP_DIR.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&path).expect("create login-item test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn legacy_launch_agent_is_migrated_without_losing_the_enabled_state() {
        let temp = TempDir::new();
        let legacy = temp.path().join("Barwarden.plist");
        fs::write(&legacy, b"legacy launch agent").expect("write legacy launch agent");
        let backend = FakeBackend::new(ServiceStatus::NotRegistered);
        let controller = LoginItemController::new(backend.clone(), legacy.clone());

        assert_eq!(controller.is_enabled(), Ok(true));
        assert_eq!(backend.status.get(), ServiceStatus::Enabled);
        assert_eq!(backend.register_calls.get(), 1);
        assert!(!legacy.exists());
    }

    #[test]
    fn disabling_removes_both_main_app_registration_and_a_legacy_agent() {
        let temp = TempDir::new();
        let legacy = temp.path().join("Barwarden.plist");
        fs::write(&legacy, b"legacy launch agent").expect("write legacy launch agent");
        let backend = FakeBackend::new(ServiceStatus::Enabled);
        let controller = LoginItemController::new(backend.clone(), legacy.clone());

        assert_eq!(controller.set_enabled(false), Ok(false));
        assert_eq!(backend.status.get(), ServiceStatus::NotRegistered);
        assert_eq!(backend.unregister_calls.get(), 1);
        assert!(!legacy.exists());
    }

    #[test]
    fn approval_required_never_reports_the_login_item_as_enabled() {
        let backend = FakeBackend::new(ServiceStatus::RequiresApproval);
        let temp = TempDir::new();
        let controller = LoginItemController::new(backend, temp.path().join("Barwarden.plist"));

        assert_eq!(controller.is_enabled(), Ok(false));
        assert_eq!(controller.set_enabled(true), Err(LoginItemError));
    }

    #[test]
    fn a_main_app_not_yet_known_to_service_management_can_be_registered() {
        let backend = FakeBackend::new(ServiceStatus::NotFound);
        let temp = TempDir::new();
        let controller =
            LoginItemController::new(backend.clone(), temp.path().join("Barwarden.plist"));

        assert_eq!(controller.is_enabled(), Ok(false));
        assert_eq!(controller.set_enabled(true), Ok(true));
        assert_eq!(backend.status.get(), ServiceStatus::Enabled);
        assert_eq!(backend.register_calls.get(), 1);
    }
}
