use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BrowserFamily {
    Safari,
    Chromium,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CapturedBrowserTarget {
    pub(crate) generation: u64,
    pub(crate) bundle_id: String,
    pub(crate) process_id: i32,
}

const SAFARI_BUNDLE_IDS: &[&str] = &["com.apple.Safari", "com.apple.SafariTechnologyPreview"];

const CHROMIUM_BUNDLE_IDS: &[&str] = &[
    "com.google.Chrome",
    "com.google.Chrome.beta",
    "com.google.Chrome.canary",
    "com.microsoft.edgemac",
    "com.microsoft.edgemac.Beta",
    "com.microsoft.edgemac.Dev",
    "com.microsoft.edgemac.Canary",
    "com.brave.Browser",
    "com.brave.Browser.beta",
    "com.brave.Browser.nightly",
    "company.thebrowser.Browser",
    "org.chromium.Chromium",
    "com.vivaldi.Vivaldi",
    "com.operasoftware.Opera",
    "com.operasoftware.OperaGX",
];

pub(crate) fn browser_family(bundle_id: &str) -> Option<BrowserFamily> {
    if SAFARI_BUNDLE_IDS.contains(&bundle_id) {
        Some(BrowserFamily::Safari)
    } else if CHROMIUM_BUNDLE_IDS.contains(&bundle_id) {
        Some(BrowserFamily::Chromium)
    } else {
        None
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ActiveTabReadError {
    PermissionDenied,
    NoActiveTab,
    Timeout,
    BrowserUnavailable,
    InvalidResult,
}

pub(crate) trait ActiveTabReader {
    fn read_url(
        &self,
        target: &CapturedBrowserTarget,
        family: BrowserFamily,
    ) -> Result<String, ActiveTabReadError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum WebsiteContextUnavailableReason {
    NoTarget,
    NotBrowser,
    PermissionDenied,
    NoActiveTab,
    InvalidUrl,
    Timeout,
    BrowserUnavailable,
    Stale,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub(crate) enum CapturedWebsiteContext {
    #[serde(rename = "available")]
    Available {
        generation: u64,
        #[serde(rename = "browserBundleId")]
        browser_bundle_id: String,
        url: String,
    },
    #[serde(rename = "unavailable")]
    Unavailable {
        generation: u64,
        reason: WebsiteContextUnavailableReason,
    },
}

fn unavailable(generation: u64, reason: WebsiteContextUnavailableReason) -> CapturedWebsiteContext {
    CapturedWebsiteContext::Unavailable { generation, reason }
}

pub(crate) fn normalized_website_url(value: &str) -> Option<String> {
    let parsed = url::Url::parse(value).ok()?;
    match parsed.scheme() {
        "http" | "https" if parsed.host_str().is_some() => Some(parsed.into()),
        _ => None,
    }
}

pub(crate) fn captured_website_context_with<Generation>(
    target: Option<CapturedBrowserTarget>,
    current_generation: Generation,
    reader: &dyn ActiveTabReader,
) -> CapturedWebsiteContext
where
    Generation: FnOnce() -> Option<u64>,
{
    let Some(target) = target else {
        return unavailable(0, WebsiteContextUnavailableReason::NoTarget);
    };
    let generation = target.generation;
    let Some(family) = browser_family(&target.bundle_id) else {
        return unavailable(generation, WebsiteContextUnavailableReason::NotBrowser);
    };

    let result = reader.read_url(&target, family);
    if current_generation() != Some(generation) {
        return unavailable(generation, WebsiteContextUnavailableReason::Stale);
    }

    match result {
        Ok(url) => normalized_website_url(&url)
            .map(|url| CapturedWebsiteContext::Available {
                generation,
                browser_bundle_id: target.bundle_id,
                url,
            })
            .unwrap_or_else(|| {
                unavailable(generation, WebsiteContextUnavailableReason::InvalidUrl)
            }),
        Err(error) => unavailable(
            generation,
            match error {
                ActiveTabReadError::PermissionDenied => {
                    WebsiteContextUnavailableReason::PermissionDenied
                }
                ActiveTabReadError::NoActiveTab => WebsiteContextUnavailableReason::NoActiveTab,
                ActiveTabReadError::Timeout => WebsiteContextUnavailableReason::Timeout,
                ActiveTabReadError::BrowserUnavailable => {
                    WebsiteContextUnavailableReason::BrowserUnavailable
                }
                ActiveTabReadError::InvalidResult => WebsiteContextUnavailableReason::InvalidUrl,
            },
        ),
    }
}

#[tauri::command]
pub(crate) async fn captured_website_context() -> CapturedWebsiteContext {
    let target = crate::frontmost::captured_target().and_then(|captured| {
        crate::frontmost::target_is_running(&captured.application).then(|| CapturedBrowserTarget {
            generation: captured.generation,
            bundle_id: captured.application.bundle_id,
            process_id: captured.application.process_id,
        })
    });

    #[cfg(target_os = "macos")]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            captured_website_context_with(
                target,
                || Some(crate::frontmost::captured_target_generation()),
                &crate::browser_context_macos::MacActiveTabReader,
            )
        })
        .await
        .unwrap_or_else(|_| unavailable(0, WebsiteContextUnavailableReason::BrowserUnavailable));
    }

    #[cfg(not(target_os = "macos"))]
    unavailable(
        target.as_ref().map_or(0, |target| target.generation),
        WebsiteContextUnavailableReason::NotBrowser,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        browser_family, captured_website_context_with, ActiveTabReadError, ActiveTabReader,
        BrowserFamily, CapturedBrowserTarget, CapturedWebsiteContext,
        WebsiteContextUnavailableReason,
    };

    struct Reader(Result<String, ActiveTabReadError>);

    impl ActiveTabReader for Reader {
        fn read_url(
            &self,
            _target: &CapturedBrowserTarget,
            _family: BrowserFamily,
        ) -> Result<String, ActiveTabReadError> {
            self.0.clone()
        }
    }

    fn target(generation: u64, bundle_id: &str) -> CapturedBrowserTarget {
        CapturedBrowserTarget {
            generation,
            bundle_id: bundle_id.to_owned(),
            process_id: 42,
        }
    }

    #[test]
    fn browser_registry_groups_supported_bundle_ids() {
        for bundle_id in ["com.apple.Safari", "com.apple.SafariTechnologyPreview"] {
            assert_eq!(browser_family(bundle_id), Some(BrowserFamily::Safari));
        }

        for bundle_id in [
            "com.google.Chrome",
            "com.google.Chrome.beta",
            "com.google.Chrome.canary",
            "com.microsoft.edgemac",
            "com.microsoft.edgemac.Beta",
            "com.microsoft.edgemac.Dev",
            "com.microsoft.edgemac.Canary",
            "com.brave.Browser",
            "com.brave.Browser.beta",
            "com.brave.Browser.nightly",
            "company.thebrowser.Browser",
            "org.chromium.Chromium",
            "com.vivaldi.Vivaldi",
            "com.operasoftware.Opera",
            "com.operasoftware.OperaGX",
        ] {
            assert_eq!(
                browser_family(bundle_id),
                Some(BrowserFamily::Chromium),
                "unexpected family for {bundle_id}",
            );
        }

        assert_eq!(browser_family("org.mozilla.firefox"), None);
        assert_eq!(browser_family("com.example.UnknownBrowser"), None);
    }

    #[test]
    fn returns_a_valid_https_url_for_the_same_captured_generation() {
        let outcome = captured_website_context_with(
            Some(target(7, "com.google.Chrome")),
            || Some(7),
            &Reader(Ok("https://login.example.com/account".to_owned())),
        );

        assert_eq!(
            outcome,
            CapturedWebsiteContext::Available {
                generation: 7,
                browser_bundle_id: "com.google.Chrome".to_owned(),
                url: "https://login.example.com/account".to_owned(),
            },
        );
    }

    #[test]
    fn rejects_internal_pages_and_results_from_an_old_capture() {
        let invalid = captured_website_context_with(
            Some(target(7, "com.google.Chrome")),
            || Some(7),
            &Reader(Ok("chrome://settings".to_owned())),
        );
        assert_eq!(
            invalid,
            CapturedWebsiteContext::Unavailable {
                generation: 7,
                reason: WebsiteContextUnavailableReason::InvalidUrl,
            },
        );

        let stale = captured_website_context_with(
            Some(target(7, "com.apple.Safari")),
            || Some(8),
            &Reader(Ok("https://example.com".to_owned())),
        );
        assert_eq!(
            stale,
            CapturedWebsiteContext::Unavailable {
                generation: 7,
                reason: WebsiteContextUnavailableReason::Stale,
            },
        );
    }

    #[test]
    fn normalizes_private_reader_errors_without_including_the_url() {
        for (error, reason) in [
            (
                ActiveTabReadError::PermissionDenied,
                WebsiteContextUnavailableReason::PermissionDenied,
            ),
            (
                ActiveTabReadError::NoActiveTab,
                WebsiteContextUnavailableReason::NoActiveTab,
            ),
            (
                ActiveTabReadError::Timeout,
                WebsiteContextUnavailableReason::Timeout,
            ),
            (
                ActiveTabReadError::BrowserUnavailable,
                WebsiteContextUnavailableReason::BrowserUnavailable,
            ),
        ] {
            let outcome = captured_website_context_with(
                Some(target(9, "com.google.Chrome")),
                || Some(9),
                &Reader(Err(error)),
            );
            assert_eq!(
                outcome,
                CapturedWebsiteContext::Unavailable {
                    generation: 9,
                    reason,
                },
            );
        }
    }

    #[test]
    fn serializes_the_exact_frontend_contract() {
        let available = CapturedWebsiteContext::Available {
            generation: 11,
            browser_bundle_id: "com.apple.Safari".to_owned(),
            url: "https://example.com/path".to_owned(),
        };
        assert_eq!(
            serde_json::to_value(available).unwrap(),
            serde_json::json!({
                "status": "available",
                "generation": 11,
                "browserBundleId": "com.apple.Safari",
                "url": "https://example.com/path",
            }),
        );

        let unavailable = CapturedWebsiteContext::Unavailable {
            generation: 12,
            reason: WebsiteContextUnavailableReason::PermissionDenied,
        };
        assert_eq!(
            serde_json::to_value(unavailable).unwrap(),
            serde_json::json!({
                "status": "unavailable",
                "generation": 12,
                "reason": "permission-denied",
            }),
        );
    }
}
