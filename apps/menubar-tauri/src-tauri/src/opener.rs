use std::process::{Command, ExitStatus};

use serde::Serialize;
use url::Url;

const ACCESSIBILITY_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UrlLaunchError {
    InvalidUrl,
    LaunchFailed,
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), UrlLaunchError> {
    open_url_with(&url, &NativeCommandRunner)
}

trait CommandRunner {
    fn run(&self, url: &str) -> Result<ExitStatus, ()>;
}

struct NativeCommandRunner;

impl CommandRunner for NativeCommandRunner {
    fn run(&self, url: &str) -> Result<ExitStatus, ()> {
        Command::new("open").arg(url).status().map_err(|_| ())
    }
}

fn open_url_with(url: &str, runner: &impl CommandRunner) -> Result<(), UrlLaunchError> {
    validate_launch_url(url)?;
    let status = runner.run(url).map_err(|_| UrlLaunchError::LaunchFailed)?;
    if !status.success() {
        return Err(UrlLaunchError::LaunchFailed);
    }

    Ok(())
}

fn validate_launch_url(value: &str) -> Result<(), UrlLaunchError> {
    if value == ACCESSIBILITY_SETTINGS_URL {
        return Ok(());
    }
    let url = Url::parse(value).map_err(|_| UrlLaunchError::InvalidUrl)?;
    match url.scheme() {
        "http" | "https" => Ok(()),
        _ => Err(UrlLaunchError::InvalidUrl),
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, os::unix::process::ExitStatusExt, process::ExitStatus};

    use super::{
        open_url_with, validate_launch_url, CommandRunner, UrlLaunchError,
        ACCESSIBILITY_SETTINGS_URL,
    };

    #[derive(Clone, Copy)]
    enum CommandOutcome {
        Success,
        ExecutionFailed,
        NonZero,
    }

    struct RecordingCommandRunner {
        outcome: CommandOutcome,
        urls: RefCell<Vec<String>>,
    }

    impl RecordingCommandRunner {
        fn new(outcome: CommandOutcome) -> Self {
            Self {
                outcome,
                urls: RefCell::new(Vec::new()),
            }
        }
    }

    impl CommandRunner for RecordingCommandRunner {
        fn run(&self, url: &str) -> Result<ExitStatus, ()> {
            self.urls.borrow_mut().push(url.to_owned());
            match self.outcome {
                CommandOutcome::Success => Ok(ExitStatus::from_raw(0)),
                CommandOutcome::ExecutionFailed => Err(()),
                CommandOutcome::NonZero => Ok(ExitStatus::from_raw(1 << 8)),
            }
        }
    }

    #[test]
    fn accepts_http_and_https_urls() {
        assert!(validate_launch_url("https://example.com").is_ok());
        assert!(validate_launch_url("http://localhost:8080").is_ok());
    }

    #[test]
    fn accepts_only_the_dedicated_accessibility_settings_handoff() {
        assert!(validate_launch_url(ACCESSIBILITY_SETTINGS_URL).is_ok());
        assert_eq!(
            validate_launch_url(
                "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
            ),
            Err(UrlLaunchError::InvalidUrl),
        );
    }

    #[test]
    fn passes_the_exact_validated_url_string_to_the_command_runner() {
        let runner = RecordingCommandRunner::new(CommandOutcome::Success);
        let urls = [
            "https://vault.bitwarden.com",
            "https://vault.bitwarden.eu",
            "https://vault.example.test/bitwarden",
        ];

        for url in urls {
            assert_eq!(open_url_with(url, &runner), Ok(()));
        }

        assert_eq!(runner.urls.into_inner(), urls);
    }

    #[test]
    fn maps_command_execution_failure_to_the_fixed_launch_status() {
        let runner = RecordingCommandRunner::new(CommandOutcome::ExecutionFailed);

        assert_eq!(
            open_url_with("https://vault.bitwarden.eu", &runner),
            Err(UrlLaunchError::LaunchFailed)
        );
    }

    #[test]
    fn maps_a_nonzero_command_exit_status_to_the_fixed_launch_status() {
        let runner = RecordingCommandRunner::new(CommandOutcome::NonZero);

        assert_eq!(
            open_url_with("https://vault.example.test/bitwarden", &runner),
            Err(UrlLaunchError::LaunchFailed)
        );
    }

    #[test]
    fn rejects_non_web_and_malformed_urls() {
        assert_eq!(
            validate_launch_url("javascript:alert(1)"),
            Err(UrlLaunchError::InvalidUrl)
        );
        assert_eq!(
            validate_launch_url("file:///etc/passwd"),
            Err(UrlLaunchError::InvalidUrl)
        );
        assert_eq!(
            validate_launch_url("not a url"),
            Err(UrlLaunchError::InvalidUrl)
        );
    }
}
