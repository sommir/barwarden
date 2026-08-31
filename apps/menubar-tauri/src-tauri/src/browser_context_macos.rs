use std::io::Read;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::browser_context::{
    ActiveTabReadError, ActiveTabReader, BrowserFamily, CapturedBrowserTarget,
};

const OSASCRIPT_PATH: &str = "/usr/bin/osascript";
const MAXIMUM_URL_BYTES: usize = 8192;
const MAXIMUM_ERROR_BYTES: usize = 4096;
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(5);
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(2);

fn browser_script(process_id: impl std::fmt::Display, family: BrowserFamily) -> String {
    let tab_property = match family {
        BrowserFamily::Safari => "currentTab",
        BrowserFamily::Chromium => "activeTab",
    };
    format!(
        r#"ObjC.import("ScriptingBridge");
const application = $.SBApplication.applicationWithProcessIdentifier({process_id});
if (!application) throw new Error("BARWARDEN_BROWSER_UNAVAILABLE");
const windows = application.valueForKey("windows");
if (!windows || Number(windows.count) < 1) throw new Error("BARWARDEN_NO_ACTIVE_TAB");
const window = windows.objectAtIndex(0);
const tab = window.valueForKey("{tab_property}");
if (!tab) throw new Error("BARWARDEN_NO_ACTIVE_TAB");
const value = tab.valueForKey("URL");
const url = value ? ObjC.unwrap(value) : null;
if (typeof url !== "string" || url.length === 0) throw new Error("BARWARDEN_INVALID_RESULT");
url;"#,
    )
}

fn stop_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn read_bounded(
    reader: Option<impl Read>,
    maximum_bytes: usize,
) -> Result<Vec<u8>, ActiveTabReadError> {
    let Some(reader) = reader else {
        return Err(ActiveTabReadError::InvalidResult);
    };
    let mut bytes = Vec::with_capacity(maximum_bytes.min(1024));
    reader
        .take((maximum_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ActiveTabReadError::InvalidResult)?;
    if bytes.len() > maximum_bytes {
        Err(ActiveTabReadError::InvalidResult)
    } else {
        Ok(bytes)
    }
}

fn mapped_script_error(stderr: &[u8]) -> ActiveTabReadError {
    let message = String::from_utf8_lossy(stderr);
    if message.contains("(-1743)") {
        ActiveTabReadError::PermissionDenied
    } else if message.contains("(-1728)") || message.contains("BARWARDEN_NO_ACTIVE_TAB") {
        ActiveTabReadError::NoActiveTab
    } else if message.contains("(-1712)") {
        ActiveTabReadError::Timeout
    } else if message.contains("(-600)")
        || message.contains("(-609)")
        || message.contains("BARWARDEN_BROWSER_UNAVAILABLE")
    {
        ActiveTabReadError::BrowserUnavailable
    } else {
        ActiveTabReadError::InvalidResult
    }
}

fn completed_output(child: &mut Child, status: ExitStatus) -> Result<String, ActiveTabReadError> {
    let stdout = read_bounded(child.stdout.take(), MAXIMUM_URL_BYTES)?;
    let stderr = read_bounded(child.stderr.take(), MAXIMUM_ERROR_BYTES)?;
    if !status.success() {
        return Err(mapped_script_error(&stderr));
    }
    let output = String::from_utf8(stdout).map_err(|_| ActiveTabReadError::InvalidResult)?;
    let output = output.trim();
    if output.is_empty() {
        Err(ActiveTabReadError::InvalidResult)
    } else {
        Ok(output.to_owned())
    }
}

fn run_osascript(source: &str, timeout: Duration) -> Result<String, ActiveTabReadError> {
    let mut child = Command::new(OSASCRIPT_PATH)
        .arg("-l")
        .arg("JavaScript")
        .arg("-e")
        .arg(source)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| ActiveTabReadError::BrowserUnavailable)?;
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => return completed_output(&mut child, status),
            Ok(None) if Instant::now() < deadline => thread::sleep(PROCESS_POLL_INTERVAL),
            Ok(None) => {
                stop_child(&mut child);
                return Err(ActiveTabReadError::Timeout);
            }
            Err(_) => {
                stop_child(&mut child);
                return Err(ActiveTabReadError::BrowserUnavailable);
            }
        }
    }
}

#[derive(Default)]
pub(crate) struct MacActiveTabReader;

impl ActiveTabReader for MacActiveTabReader {
    fn read_url(
        &self,
        target: &CapturedBrowserTarget,
        family: BrowserFamily,
    ) -> Result<String, ActiveTabReadError> {
        run_osascript(&browser_script(target.process_id, family), SCRIPT_TIMEOUT)
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{browser_script, run_osascript};
    use crate::browser_context::{ActiveTabReadError, BrowserFamily};

    #[test]
    fn browser_script_targets_the_captured_process_instead_of_the_bundle_id() {
        let source = browser_script("42", BrowserFamily::Chromium);

        assert!(source.contains("applicationWithProcessIdentifier(42)"));
        assert!(!source.contains("tell application id"));
    }

    #[test]
    fn isolated_script_runner_returns_bounded_output() {
        assert_eq!(
            run_osascript(
                "\"https://login.example.com/account\"",
                Duration::from_secs(2),
            ),
            Ok("https://login.example.com/account".to_owned()),
        );
    }

    #[test]
    fn isolated_script_runner_maps_tcc_denial_without_crashing_the_host() {
        assert_eq!(
            run_osascript(
                "throw new Error(\"Not authorized to send Apple events. (-1743)\")",
                Duration::from_secs(2),
            ),
            Err(ActiveTabReadError::PermissionDenied),
        );
    }

    #[test]
    fn isolated_script_runner_enforces_a_hard_deadline() {
        let started = Instant::now();
        assert_eq!(
            run_osascript("delay(5)", Duration::from_millis(25)),
            Err(ActiveTabReadError::Timeout),
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
