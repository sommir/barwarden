use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use crate::autofill_contract::{
    AgentErrorCode, AgentSessionPayload, AutoFillSecretField, CandidateGroup,
    CandidateQueryPayload, CandidateResponsePayload, NativeAutoFillContext,
};
use crate::browser_context::ActiveTabReadError;

pub(crate) const MAX_VISIBLE_SUGGESTIONS: usize = 5;

const ALLOWED_OTHER_REASONS: &[&str] =
    &["application_name", "application_name_similar", "fuzzy_name"];

const QUERY_FIELDS: [AutoFillSecretField; 3] = [
    AutoFillSecretField::Username,
    AutoFillSecretField::Password,
    AutoFillSecretField::Totp,
];

pub(crate) fn format_tray_title(count: Option<usize>) -> String {
    match count {
        Some(count) if count > 0 => count.min(MAX_VISIBLE_SUGGESTIONS).to_string(),
        _ => String::new(),
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum BrowserUrlDecision {
    Unchanged,
    Query(String),
    Clear,
}

pub(crate) fn browser_url_decision(
    previous: Option<&str>,
    result: Result<&str, ActiveTabReadError>,
    force_refresh: bool,
) -> BrowserUrlDecision {
    let Ok(value) = result else {
        return BrowserUrlDecision::Clear;
    };
    let Some(url) = crate::browser_context::normalized_website_url(value) else {
        return BrowserUrlDecision::Clear;
    };
    if previous == Some(url.as_str()) && !force_refresh {
        BrowserUrlDecision::Unchanged
    } else {
        BrowserUrlDecision::Query(url)
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum SelfActivationDecision {
    Retain,
    Clear,
}

pub(crate) fn self_activation_decision(observed_target_is_running: bool) -> SelfActivationDecision {
    if observed_target_is_running {
        SelfActivationDecision::Retain
    } else {
        SelfActivationDecision::Clear
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum LifecycleDecision {
    Clear,
    Refresh,
    NoChange,
}

pub(crate) fn lifecycle_decision(
    authorization: crate::session_broker::AuthorizationState,
    projection_replaced: bool,
) -> LifecycleDecision {
    if authorization != crate::session_broker::AuthorizationState::Unlocked {
        LifecycleDecision::Clear
    } else if projection_replaced {
        LifecycleDecision::Refresh
    } else {
        LifecycleDecision::NoChange
    }
}

fn take_refresh_request(refresh_requested: &mut bool, retry_pending: &mut bool) -> bool {
    std::mem::take(refresh_requested) || std::mem::take(retry_pending)
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum RetryDecision {
    WaitForTimer,
    RunNow,
    Idle,
}

pub(crate) fn retry_decision(retry_pending: bool, refresh_requested: bool) -> RetryDecision {
    if refresh_requested {
        RetryDecision::RunNow
    } else if retry_pending {
        RetryDecision::WaitForTimer
    } else {
        RetryDecision::Idle
    }
}

pub(crate) fn publication_target_is_current(
    frontmost: Option<&crate::frontmost::FrontmostApp>,
    observed: &crate::frontmost::FrontmostApp,
    observed_is_running: bool,
) -> bool {
    match frontmost {
        Some(frontmost) if frontmost == observed => true,
        Some(frontmost) if frontmost.bundle_id == crate::brand::BUNDLE_IDENTIFIER => {
            observed_is_running
        }
        _ => false,
    }
}

pub(crate) fn apply_tray_title(app: &tauri::AppHandle, count: Option<usize>) -> tauri::Result<()> {
    let title = format_tray_title(count);
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_title(Some(title))?;
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ObservedIdentity {
    pub(crate) bundle_id: String,
    pub(crate) process_id: i32,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum PublishDecision {
    Apply(String),
    Unchanged,
    Stale,
}

#[derive(Default)]
pub(crate) struct ObservationState {
    generation: u64,
    observed: Option<ObservedIdentity>,
    title: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct MonitorSnapshot {
    generation: u64,
    observed: Option<ObservedIdentity>,
    title: String,
    refresh_requested: bool,
    retry_pending: bool,
}

struct MonitorInner {
    state: Mutex<MonitorState>,
    wake: Condvar,
    title_sink: Box<dyn Fn(&str) + Send + Sync>,
    context_sink: Box<dyn Fn(u64) + Send + Sync>,
}

struct MonitorState {
    observation: ObservationState,
    observed_application: Option<crate::frontmost::FrontmostApp>,
    refresh_requested: bool,
    app_name: String,
    browser_url: Option<String>,
    retry_pending: bool,
    published_revision: u64,
}

impl Default for MonitorState {
    fn default() -> Self {
        Self {
            observation: ObservationState::default(),
            observed_application: None,
            refresh_requested: true,
            app_name: String::new(),
            browser_url: None,
            retry_pending: false,
            published_revision: 0,
        }
    }
}

#[derive(Clone)]
pub(crate) struct SuggestionCountMonitor {
    inner: Arc<MonitorInner>,
}

impl Default for SuggestionCountMonitor {
    fn default() -> Self {
        Self::with_title_sink(|_| {})
    }
}

impl SuggestionCountMonitor {
    pub(crate) fn with_title_sink(title_sink: impl Fn(&str) + Send + Sync + 'static) -> Self {
        Self::with_sinks(title_sink, |_| {})
    }

    pub(crate) fn with_sinks(
        title_sink: impl Fn(&str) + Send + Sync + 'static,
        context_sink: impl Fn(u64) + Send + Sync + 'static,
    ) -> Self {
        Self {
            inner: Arc::new(MonitorInner {
                state: Mutex::new(MonitorState::default()),
                wake: Condvar::new(),
                title_sink: Box::new(title_sink),
                context_sink: Box::new(context_sink),
            }),
        }
    }

    pub(crate) fn invalidate(&self) {
        {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.observation.invalidate_projection();
            state.refresh_requested = true;
            self.inner.wake.notify_one();
        }
    }

    pub(crate) fn observe_activation(&self, target: Option<crate::frontmost::FrontmostApp>) {
        let Some(target) = target else {
            self.clear_target();
            return;
        };
        if target.bundle_id == crate::brand::BUNDLE_IDENTIFIER {
            return;
        }
        let identity = ObservedIdentity {
            bundle_id: target.bundle_id.clone(),
            process_id: target.process_id,
        };
        {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.app_name = target.app_name().to_owned();
            state.observed_application = Some(target);
            state.browser_url = None;
            state.retry_pending = false;
            state.observation.begin_external(identity);
            state.refresh_requested = true;
            self.inner.wake.notify_one();
        }
    }

    pub(crate) fn current_revision(&self) -> u64 {
        self.inner
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .published_revision
    }

    pub(crate) fn observe_termination(&self) {
        if !self.observed_target_is_running() {
            self.clear_target();
        }
    }

    pub(crate) fn start(&self) {
        let monitor = self.clone();
        std::thread::Builder::new()
            .name("barwarden-suggestion-count".to_owned())
            .spawn(move || monitor.run())
            .expect("failed to start suggestion count monitor");
    }

    fn run(&self) {
        loop {
            self.refresh();
            let state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let _ = self
                .inner
                .wake
                .wait_timeout_while(state, Duration::from_secs(1), |state| {
                    !state.refresh_requested
                });
        }
    }

    fn refresh(&self) {
        let frontmost = crate::frontmost::current_frontmost_app().ok().flatten();
        if frontmost
            .as_ref()
            .is_some_and(|target| target.bundle_id == crate::brand::BUNDLE_IDENTIFIER)
        {
            let observed_is_running = self.observed_target_is_running();
            if self_activation_decision(observed_is_running) == SelfActivationDecision::Clear {
                self.clear_target();
                return;
            }
            let observed_is_browser = self
                .inner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .observation
                .observed()
                .is_some_and(|target| {
                    crate::browser_context::browser_family(&target.bundle_id).is_some()
                });
            if observed_is_browser {
                self.refresh_observed_browser();
            } else {
                self.refresh_observed_application();
            }
            return;
        }
        let Some(target) = frontmost else {
            self.clear_target();
            return;
        };
        let identity = ObservedIdentity {
            bundle_id: target.bundle_id.clone(),
            process_id: target.process_id,
        };
        {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let changed = state.observation.observed() != Some(&identity);
            if changed {
                state.app_name = target.app_name().to_owned();
                state.observed_application = Some(target.clone());
                state.browser_url = None;
                state.retry_pending = false;
                state.observation.begin_external(identity.clone());
            }
        }
        if crate::browser_context::browser_family(&identity.bundle_id).is_some() {
            self.refresh_observed_browser();
        } else {
            self.refresh_observed_application();
        }
    }

    fn refresh_observed_application(&self) {
        let query = {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if retry_decision(state.retry_pending, state.refresh_requested) == RetryDecision::Idle {
                return;
            }
            let Some(identity) = state.observation.observed().cloned() else {
                return;
            };
            let retrying = state.retry_pending && !state.refresh_requested;
            state.refresh_requested = false;
            state.retry_pending = false;
            if retrying {
                state.observation.invalidate_projection();
            }
            Some((
                state.observation.generation(),
                identity,
                state.app_name.clone(),
            ))
        };
        if let Some((generation, identity, app_name)) = query {
            self.query_and_publish(generation, identity, app_name, None);
        }
    }

    fn refresh_observed_browser(&self) {
        let (generation, identity, app_name, previous, force_refresh) = {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let Some(identity) = state.observation.observed().cloned() else {
                return;
            };
            if crate::browser_context::browser_family(&identity.bundle_id).is_none() {
                return;
            }
            let force_refresh = {
                let MonitorState {
                    refresh_requested,
                    retry_pending,
                    ..
                } = &mut *state;
                take_refresh_request(refresh_requested, retry_pending)
            };
            (
                state.observation.generation(),
                identity,
                state.app_name.clone(),
                state.browser_url.clone(),
                force_refresh,
            )
        };
        let Some(family) = crate::browser_context::browser_family(&identity.bundle_id) else {
            return;
        };
        let target = crate::browser_context::CapturedBrowserTarget {
            generation,
            bundle_id: identity.bundle_id.clone(),
            process_id: identity.process_id,
        };
        use crate::browser_context::ActiveTabReader;
        let read = crate::browser_context_macos::MacActiveTabReader.read_url(&target, family);
        match browser_url_decision(
            previous.as_deref(),
            read.as_deref().map_err(Clone::clone),
            force_refresh,
        ) {
            BrowserUrlDecision::Unchanged => {}
            BrowserUrlDecision::Clear => self.clear_browser_result(generation),
            BrowserUrlDecision::Query(url) => {
                let query_generation = {
                    let mut state = self
                        .inner
                        .state
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    if state.observation.generation() != generation {
                        return;
                    }
                    state.browser_url = Some(url.clone());
                    state.observation.invalidate_projection()
                };
                self.query_and_publish(query_generation, identity, app_name, Some(url));
            }
        }
    }

    fn observed_target_is_running(&self) -> bool {
        let observed = self
            .inner
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .observed_application
            .as_ref()
            .cloned();
        let Some(observed) = observed else {
            return false;
        };
        crate::frontmost::target_is_running(&observed)
    }

    fn query_and_publish(
        &self,
        generation: u64,
        identity: ObservedIdentity,
        app_name: String,
        service_identifier: Option<String>,
    ) {
        let context = NativeAutoFillContext {
            bundle_id: identity.bundle_id,
            app_name,
            service_identifiers: service_identifier.into_iter().collect(),
            query: String::new(),
        };
        let count = crate::autofill_ipc::AgentClient::system_default()
            .and_then(|client| count_agent_suggestions(&client, context));
        let observed_application = self
            .inner
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .observed_application
            .clone();
        let target_is_current = observed_application.as_ref().is_some_and(|observed| {
            let frontmost = crate::frontmost::current_frontmost_app().ok().flatten();
            publication_target_is_current(
                frontmost.as_ref(),
                observed,
                crate::frontmost::target_is_running(observed),
            )
        });
        let decision = {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let decision = match count {
                _ if !target_is_current => PublishDecision::Stale,
                Ok(count) => state.observation.publish(generation, count),
                Err(_) if state.observation.generation() == generation => {
                    state.observation.title.clear();
                    state.retry_pending = true;
                    PublishDecision::Apply(String::new())
                }
                Err(_) => PublishDecision::Stale,
            };
            if decision != PublishDecision::Stale {
                state.published_revision = generation;
            }
            decision
        };
        self.publish_decision(generation, decision);
    }

    fn clear_browser_result(&self, generation: u64) {
        let (should_clear, revision) = {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if state.observation.generation() != generation {
                return;
            }
            let had_browser_url = state.browser_url.take().is_some();
            state.retry_pending = false;
            let should_clear = !state.observation.title().is_empty();
            let revision = if had_browser_url {
                state.observation.invalidate_projection()
            } else {
                generation
            };
            state.observation.title.clear();
            let should_publish = had_browser_url || state.published_revision != revision;
            if should_publish {
                state.published_revision = revision;
            }
            (should_clear, should_publish.then_some(revision))
        };
        if should_clear {
            (self.inner.title_sink)("");
        }
        if let Some(revision) = revision {
            (self.inner.context_sink)(revision);
        }
    }

    fn publish_decision(&self, revision: u64, decision: PublishDecision) {
        match decision {
            PublishDecision::Apply(title) => {
                (self.inner.title_sink)(&title);
                (self.inner.context_sink)(revision);
            }
            PublishDecision::Unchanged => (self.inner.context_sink)(revision),
            PublishDecision::Stale => {}
        }
    }

    fn clear_target(&self) {
        let (should_clear, revision) = {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let should_clear = !state.observation.title().is_empty();
            let context_changed = state.observation.observed.is_some()
                || state.observed_application.is_some()
                || state.browser_url.is_some();
            let revision = state.observation.next_generation();
            state.observation.observed = None;
            state.observed_application = None;
            state.observation.title.clear();
            state.app_name.clear();
            state.browser_url = None;
            state.retry_pending = false;
            state.refresh_requested = false;
            state.retry_pending = false;
            if context_changed {
                state.published_revision = revision;
            }
            (should_clear, context_changed.then_some(revision))
        };
        if should_clear {
            (self.inner.title_sink)("");
        }
        if let Some(revision) = revision {
            (self.inner.context_sink)(revision);
        }
    }

    pub(crate) fn clear(&self) {
        let (should_clear, revision) = {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let should_clear = !state.observation.title().is_empty();
            let revision = state.observation.invalidate_projection();
            state.observation.title.clear();
            state.refresh_requested = false;
            state.retry_pending = false;
            if should_clear {
                state.published_revision = revision;
            }
            (should_clear, should_clear.then_some(revision))
        };
        if should_clear {
            (self.inner.title_sink)("");
        }
        if let Some(revision) = revision {
            (self.inner.context_sink)(revision);
        }
    }

    #[cfg(test)]
    fn begin_external_for_test(&self, target: ObservedIdentity) -> u64 {
        let generation = {
            let mut state = self.inner.state.lock().unwrap();
            let generation = state.observation.begin_external(target);
            state.refresh_requested = true;
            generation
        };
        if generation == 1 {
            (self.inner.title_sink)("");
        }
        generation
    }

    #[cfg(test)]
    fn publish_for_test(&self, generation: u64, count: usize) {
        let decision = {
            let mut state = self.inner.state.lock().unwrap();
            let decision = state.observation.publish(generation, count);
            if decision != PublishDecision::Stale {
                state.published_revision = generation;
            }
            decision
        };
        self.publish_decision(generation, decision);
    }

    #[cfg(test)]
    fn snapshot_for_test(&self) -> MonitorSnapshot {
        let state = self.inner.state.lock().unwrap();
        MonitorSnapshot {
            generation: state.observation.generation(),
            observed: state.observation.observed().cloned(),
            title: state.observation.title().to_owned(),
            refresh_requested: state.refresh_requested,
            retry_pending: state.retry_pending,
        }
    }

    #[cfg(test)]
    fn mark_retry_for_test(&self) {
        self.inner.state.lock().unwrap().retry_pending = true;
    }
}

impl ObservationState {
    fn next_generation(&mut self) -> u64 {
        self.generation = self.generation.checked_add(1).unwrap_or(1);
        self.generation
    }

    pub(crate) fn begin_external(&mut self, target: ObservedIdentity) -> u64 {
        let generation = self.next_generation();
        self.observed = Some(target);
        generation
    }

    pub(crate) fn invalidate_projection(&mut self) -> u64 {
        self.next_generation()
    }

    pub(crate) fn publish(&mut self, generation: u64, count: usize) -> PublishDecision {
        if generation != self.generation {
            return PublishDecision::Stale;
        }
        let title = format_tray_title(Some(count));
        if title == self.title {
            PublishDecision::Unchanged
        } else {
            self.title = title.clone();
            PublishDecision::Apply(title)
        }
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn observed(&self) -> Option<&ObservedIdentity> {
        self.observed.as_ref()
    }

    pub(crate) fn title(&self) -> &str {
        &self.title
    }
}

pub(crate) trait SuggestionAgentPort {
    fn session(&self) -> Result<AgentSessionPayload, AgentErrorCode>;
    fn candidates(
        &self,
        payload: CandidateQueryPayload,
    ) -> Result<CandidateResponsePayload, AgentErrorCode>;
}

pub(crate) fn count_agent_suggestions(
    agent: &dyn SuggestionAgentPort,
    context: NativeAutoFillContext,
) -> Result<usize, AgentErrorCode> {
    let session = agent.session()?;
    let responses = QUERY_FIELDS.map(|field| {
        agent.candidates(CandidateQueryPayload {
            generation: session.generation.clone(),
            account_id: session.account_id.clone(),
            field,
            context: context.clone(),
        })
    });
    let live_session = agent.session()?;
    if live_session != session {
        return Err(AgentErrorCode::StaleRevision);
    }
    count_eligible_responses(&responses).ok_or(AgentErrorCode::Unavailable)
}

struct MergedCandidate<'a> {
    group: &'a CandidateGroup,
    reason: &'a str,
    first_agent_order: usize,
}

fn group_rank(group: &CandidateGroup) -> usize {
    match group {
        CandidateGroup::Exact => 0,
        CandidateGroup::Relevant => 1,
        CandidateGroup::Other => 2,
    }
}

fn eligible(group: &CandidateGroup, reason: &str) -> bool {
    group != &CandidateGroup::Other || ALLOWED_OTHER_REASONS.contains(&reason)
}

fn count_eligible_responses(
    responses: &[Result<CandidateResponsePayload, AgentErrorCode>; 3],
) -> Option<usize> {
    if responses.iter().all(Result::is_err) {
        return None;
    }

    let mut merged = HashMap::<&str, MergedCandidate<'_>>::new();
    let mut agent_order = 0;
    for response in responses
        .iter()
        .filter_map(|response| response.as_ref().ok())
    {
        for candidate in &response.candidates {
            let entry = merged
                .entry(candidate.cipher_id.as_str())
                .or_insert(MergedCandidate {
                    group: &candidate.group,
                    reason: &candidate.reason,
                    first_agent_order: agent_order,
                });
            if group_rank(&candidate.group) < group_rank(entry.group) {
                entry.group = &candidate.group;
                entry.reason = &candidate.reason;
            }
            agent_order += 1;
        }
    }

    let mut candidates: Vec<_> = merged.into_values().collect();
    candidates.sort_by_key(|candidate| (group_rank(candidate.group), candidate.first_agent_order));
    Some(
        candidates
            .into_iter()
            .filter(|candidate| eligible(candidate.group, candidate.reason))
            .take(MAX_VISIBLE_SUGGESTIONS)
            .count(),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use crate::autofill_contract::{
        AgentErrorCode, AgentSessionPayload, AutoFillSecretField, CandidateGroup,
        CandidateQueryPayload, CandidateResponsePayload, NativeAutoFillContext, RankedCandidate,
    };
    use crate::browser_context::ActiveTabReadError;
    use crate::session_broker::AuthorizationState;

    use super::{
        browser_url_decision, count_agent_suggestions, count_eligible_responses, format_tray_title,
        lifecycle_decision, publication_target_is_current, retry_decision,
        self_activation_decision, take_refresh_request, BrowserUrlDecision, LifecycleDecision,
        ObservationState, ObservedIdentity, PublishDecision, RetryDecision, SelfActivationDecision,
        SuggestionAgentPort, SuggestionCountMonitor, MAX_VISIBLE_SUGGESTIONS,
    };

    struct RecordingAgent {
        sessions: Mutex<Vec<AgentSessionPayload>>,
        fields: Mutex<Vec<AutoFillSecretField>>,
    }

    impl RecordingAgent {
        fn stable() -> Self {
            Self::with_sessions(session(4), session(4))
        }

        fn with_sessions(first: AgentSessionPayload, second: AgentSessionPayload) -> Self {
            Self {
                sessions: Mutex::new(vec![second, first]),
                fields: Mutex::new(Vec::new()),
            }
        }
    }

    impl SuggestionAgentPort for RecordingAgent {
        fn session(&self) -> Result<AgentSessionPayload, AgentErrorCode> {
            self.sessions
                .lock()
                .unwrap()
                .pop()
                .ok_or(AgentErrorCode::Unavailable)
        }

        fn candidates(
            &self,
            payload: CandidateQueryPayload,
        ) -> Result<CandidateResponsePayload, AgentErrorCode> {
            self.fields.lock().unwrap().push(payload.field);
            Ok(response(vec![candidate(
                "a",
                CandidateGroup::Exact,
                "uri_exact",
            )]))
        }
    }

    fn session(vault_revision: u64) -> AgentSessionPayload {
        AgentSessionPayload {
            generation: "00000000-0000-4000-8000-000000000004".to_owned(),
            account_id: "account-a".to_owned(),
            vault_revision,
        }
    }

    fn context() -> NativeAutoFillContext {
        NativeAutoFillContext {
            bundle_id: "com.google.Chrome".to_owned(),
            app_name: "Google Chrome".to_owned(),
            service_identifiers: vec!["https://login.example.com/account".to_owned()],
            query: String::new(),
        }
    }

    fn candidate(cipher_id: &str, group: CandidateGroup, reason: &str) -> RankedCandidate {
        RankedCandidate {
            cipher_id: cipher_id.to_owned(),
            display_name: format!("Item {cipher_id}"),
            username: format!("user-{cipher_id}"),
            group,
            reason: reason.to_owned(),
            requires_mismatch_confirmation: false,
        }
    }

    fn response(candidates: Vec<RankedCandidate>) -> CandidateResponsePayload {
        CandidateResponsePayload {
            context_token: "00000000-0000-4000-8000-000000000001".to_owned(),
            candidates,
        }
    }

    #[test]
    fn candidate_count_deduplicates_fields_uses_strongest_group_and_caps_at_five() {
        let responses = [
            Ok(response(vec![
                candidate("a", CandidateGroup::Exact, "uri_exact"),
                candidate("b", CandidateGroup::Other, "favorite"),
            ])),
            Ok(response(vec![
                candidate("b", CandidateGroup::Relevant, "uri_host"),
                candidate("c", CandidateGroup::Other, "application_name"),
            ])),
            Ok(response(vec![
                candidate("d", CandidateGroup::Exact, "uri_exact"),
                candidate("e", CandidateGroup::Exact, "uri_exact"),
                candidate("f", CandidateGroup::Exact, "uri_exact"),
                candidate("g", CandidateGroup::Exact, "uri_exact"),
            ])),
        ];

        assert_eq!(count_eligible_responses(&responses), Some(5));
        assert_eq!(MAX_VISIBLE_SUGGESTIONS, 5);
    }

    #[test]
    fn candidate_count_rejects_unrelated_other_reasons() {
        let responses = [
            Ok(response(vec![
                candidate("favorite", CandidateGroup::Other, "favorite"),
                candidate("similar", CandidateGroup::Other, "application_name_similar"),
            ])),
            Ok(response(Vec::new())),
            Ok(response(Vec::new())),
        ];

        assert_eq!(count_eligible_responses(&responses), Some(1));
    }

    #[test]
    fn candidate_count_uses_successful_field_queries_when_one_field_fails() {
        let responses = [
            Ok(response(vec![candidate(
                "a",
                CandidateGroup::Exact,
                "uri_exact",
            )])),
            Err(AgentErrorCode::Unavailable),
            Ok(response(Vec::new())),
        ];

        assert_eq!(count_eligible_responses(&responses), Some(1));
    }

    #[test]
    fn candidate_count_fails_closed_when_all_field_queries_fail() {
        let responses = [
            Err(AgentErrorCode::Unavailable),
            Err(AgentErrorCode::Timeout),
            Err(AgentErrorCode::Transport),
        ];

        assert_eq!(count_eligible_responses(&responses), None);
    }

    #[test]
    fn agent_count_queries_all_fields_against_one_stable_session() {
        let agent = RecordingAgent::stable();

        assert_eq!(count_agent_suggestions(&agent, context()), Ok(1));
        assert_eq!(
            *agent.fields.lock().unwrap(),
            [
                AutoFillSecretField::Username,
                AutoFillSecretField::Password,
                AutoFillSecretField::Totp,
            ],
        );
    }

    #[test]
    fn agent_count_rejects_a_session_that_changes_during_queries() {
        let agent = RecordingAgent::with_sessions(session(4), session(5));

        assert_eq!(
            count_agent_suggestions(&agent, context()),
            Err(AgentErrorCode::StaleRevision),
        );
    }

    #[test]
    fn tray_title_hides_zero_and_clamps_to_the_visible_limit() {
        assert_eq!(format_tray_title(None), "");
        assert_eq!(format_tray_title(Some(0)), "");
        assert_eq!(format_tray_title(Some(1)), "1");
        assert_eq!(format_tray_title(Some(4)), "4");
        assert_eq!(format_tray_title(Some(5)), "5");
        assert_eq!(format_tray_title(Some(99)), "5");
    }

    fn identity(bundle_id: &str, process_id: i32) -> ObservedIdentity {
        ObservedIdentity {
            bundle_id: bundle_id.to_owned(),
            process_id,
        }
    }

    #[test]
    fn external_target_change_retains_the_last_title_until_the_new_publication() {
        let mut state = ObservationState::default();
        let chrome_generation = state.begin_external(identity("com.google.Chrome", 10));
        assert_eq!(
            state.publish(chrome_generation, 4),
            PublishDecision::Apply("4".to_owned())
        );

        let safari_generation = state.begin_external(identity("com.apple.Safari", 20));

        assert_eq!(state.title(), "4");
        assert_eq!(state.publish(chrome_generation, 5), PublishDecision::Stale);
        assert_eq!(
            state.publish(safari_generation, 2),
            PublishDecision::Apply("2".to_owned())
        );
    }

    #[test]
    fn self_activation_preserves_the_external_target_and_title() {
        let mut state = ObservationState::default();
        let generation = state.begin_external(identity("com.google.Chrome", 10));
        assert_eq!(
            state.publish(generation, 4),
            PublishDecision::Apply("4".to_owned())
        );

        assert_eq!(state.generation(), generation);
        assert_eq!(state.observed(), Some(&identity("com.google.Chrome", 10)));
        assert_eq!(state.title(), "4");
    }

    #[test]
    fn projection_invalidation_retains_the_title_and_observed_target_during_refresh() {
        let mut state = ObservationState::default();
        let generation = state.begin_external(identity("com.example.App", 30));
        assert_eq!(
            state.publish(generation, 3),
            PublishDecision::Apply("3".to_owned())
        );

        let invalidated_generation = state.invalidate_projection();

        assert_eq!(state.title(), "3");
        assert_eq!(state.observed(), Some(&identity("com.example.App", 30)));
        assert!(invalidated_generation > generation);
        assert_eq!(state.publish(generation, 3), PublishDecision::Stale);
    }

    #[test]
    fn unchanged_full_browser_url_skips_the_agent_query() {
        assert_eq!(
            browser_url_decision(
                Some("https://login.example.com/account"),
                Ok("https://login.example.com/account"),
                false,
            ),
            BrowserUrlDecision::Unchanged,
        );
    }

    #[test]
    fn browser_path_change_on_the_same_full_hostname_requests_a_new_query() {
        assert_eq!(
            browser_url_decision(
                Some("https://login.example.com/account"),
                Ok("https://login.example.com/settings"),
                false,
            ),
            BrowserUrlDecision::Query("https://login.example.com/settings".to_owned()),
        );
    }

    #[test]
    fn invalid_internal_or_unreadable_browser_urls_clear_the_count() {
        assert_eq!(
            browser_url_decision(None, Ok("chrome://settings"), false),
            BrowserUrlDecision::Clear,
        );
        assert_eq!(
            browser_url_decision(
                Some("https://login.example.com/account"),
                Err(ActiveTabReadError::PermissionDenied),
                false,
            ),
            BrowserUrlDecision::Clear,
        );
    }

    #[test]
    fn forced_browser_refresh_queries_even_when_the_full_url_is_unchanged() {
        assert_eq!(
            browser_url_decision(
                Some("https://login.example.com/account"),
                Ok("https://login.example.com/account"),
                true,
            ),
            BrowserUrlDecision::Query("https://login.example.com/account".to_owned()),
        );
    }

    #[test]
    fn self_activation_retains_only_a_still_running_external_target() {
        assert_eq!(
            self_activation_decision(true),
            SelfActivationDecision::Retain
        );
        assert_eq!(
            self_activation_decision(false),
            SelfActivationDecision::Clear
        );
    }

    #[test]
    fn monitor_invalidation_keeps_the_title_visible_while_waking_the_worker() {
        let writes = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&writes);
        let monitor = SuggestionCountMonitor::with_title_sink(move |title| {
            recorded.lock().unwrap().push(title.to_owned());
        });
        let generation = monitor.begin_external_for_test(identity("com.example.App", 30));
        monitor.publish_for_test(generation, 3);

        monitor.invalidate();

        let snapshot = monitor.snapshot_for_test();
        assert!(snapshot.generation > generation);
        assert_eq!(snapshot.observed, Some(identity("com.example.App", 30)));
        assert_eq!(snapshot.title, "3");
        assert!(snapshot.refresh_requested);
        assert_eq!(*writes.lock().unwrap(), ["", "3"]);
    }

    #[test]
    fn external_target_refresh_replaces_the_number_without_an_intermediate_blank() {
        let writes = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&writes);
        let monitor = SuggestionCountMonitor::with_title_sink(move |title| {
            recorded.lock().unwrap().push(title.to_owned());
        });
        let first = monitor.begin_external_for_test(identity("com.google.Chrome", 30));
        monitor.publish_for_test(first, 4);

        let second = monitor.begin_external_for_test(identity("com.apple.Safari", 31));
        assert_eq!(*writes.lock().unwrap(), ["", "4"]);

        monitor.publish_for_test(second, 2);
        assert_eq!(*writes.lock().unwrap(), ["", "4", "2"]);
    }

    #[test]
    fn monitor_clear_is_idempotent_for_the_title_sink() {
        let writes = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&writes);
        let monitor = SuggestionCountMonitor::with_title_sink(move |title| {
            recorded.lock().unwrap().push(title.to_owned());
        });
        let generation = monitor.begin_external_for_test(identity("com.example.App", 30));
        monitor.publish_for_test(generation, 3);

        monitor.clear();
        monitor.clear();

        assert_eq!(*writes.lock().unwrap(), ["", "3", ""]);
    }

    #[test]
    fn lifecycle_policy_clears_non_unlocked_sessions_and_refreshes_only_after_projection() {
        assert_eq!(
            lifecycle_decision(AuthorizationState::Locked, false),
            LifecycleDecision::Clear,
        );
        assert_eq!(
            lifecycle_decision(AuthorizationState::SignedOut, false),
            LifecycleDecision::Clear,
        );
        assert_eq!(
            lifecycle_decision(AuthorizationState::RecoveryRequired, false),
            LifecycleDecision::Clear,
        );
        assert_eq!(
            lifecycle_decision(AuthorizationState::Unlocked, false),
            LifecycleDecision::NoChange,
        );
        assert_eq!(
            lifecycle_decision(AuthorizationState::Unlocked, true),
            LifecycleDecision::Refresh,
        );
    }

    #[test]
    fn browser_branch_consumes_the_pending_refresh_instead_of_the_application_branch() {
        let mut requested = true;

        let mut retry_pending = false;
        assert!(take_refresh_request(&mut requested, &mut retry_pending));
        assert!(!requested);

        requested = true;
        assert!(take_refresh_request(&mut requested, &mut retry_pending));
        assert!(!requested);
    }

    #[test]
    fn transient_agent_failure_retries_on_the_next_timer_without_busy_spinning() {
        assert_eq!(retry_decision(true, false), RetryDecision::WaitForTimer);
        assert_eq!(retry_decision(false, true), RetryDecision::RunNow);
        assert_eq!(retry_decision(false, false), RetryDecision::Idle);
    }

    #[test]
    fn browser_consumes_pending_retry_as_a_forced_same_url_refresh() {
        let mut refresh_requested = false;
        let mut retry_pending = true;

        assert!(take_refresh_request(
            &mut refresh_requested,
            &mut retry_pending,
        ));
        assert!(!refresh_requested);
        assert!(!retry_pending);
    }

    #[test]
    fn lifecycle_clear_cancels_pending_retry() {
        let monitor = SuggestionCountMonitor::default();
        monitor.mark_retry_for_test();

        monitor.clear();

        assert!(!monitor.snapshot_for_test().retry_pending);
    }

    #[test]
    fn accepted_publication_notifies_the_context_after_applying_the_title() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let title_events = Arc::clone(&events);
        let context_events = Arc::clone(&events);
        let monitor = SuggestionCountMonitor::with_sinks(
            move |title| {
                title_events.lock().unwrap().push(format!("title:{title}"));
            },
            move |revision| {
                context_events
                    .lock()
                    .unwrap()
                    .push(format!("context:{revision}"));
            },
        );
        let generation = monitor.begin_external_for_test(identity("com.google.Chrome", 30));
        events.lock().unwrap().clear();

        monitor.publish_for_test(generation, 4);

        assert_eq!(*events.lock().unwrap(), ["title:4", "context:1"]);
    }

    #[test]
    fn accepted_same_count_publication_still_notifies_the_context() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let context_events = Arc::clone(&events);
        let monitor = SuggestionCountMonitor::with_sinks(
            |_| {},
            move |revision| {
                context_events
                    .lock()
                    .unwrap()
                    .push(format!("context:{revision}"));
            },
        );
        let first = monitor.begin_external_for_test(identity("com.google.Chrome", 30));
        monitor.publish_for_test(first, 4);
        events.lock().unwrap().clear();

        let second = monitor.begin_external_for_test(identity("com.google.Chrome", 30));
        monitor.publish_for_test(second, 4);

        assert_eq!(*events.lock().unwrap(), ["context:2"]);
    }

    #[test]
    fn stale_publication_does_not_notify_the_context() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let context_events = Arc::clone(&events);
        let monitor = SuggestionCountMonitor::with_sinks(
            |_| {},
            move |revision| {
                context_events
                    .lock()
                    .unwrap()
                    .push(format!("context:{revision}"));
            },
        );
        let stale = monitor.begin_external_for_test(identity("com.google.Chrome", 30));
        let _current = monitor.begin_external_for_test(identity("com.apple.Safari", 31));
        events.lock().unwrap().clear();

        monitor.publish_for_test(stale, 4);

        assert!(events.lock().unwrap().is_empty());
    }

    #[test]
    fn publication_requires_the_exact_instance_or_a_live_target_behind_barwarden() {
        let observed =
            crate::frontmost::test_frontmost_app_named("com.example.App", "Example", 30, 7);
        let replacement =
            crate::frontmost::test_frontmost_app_named("com.example.App", "Example", 30, 8);
        let barwarden = crate::frontmost::test_frontmost_app_named(
            crate::brand::BUNDLE_IDENTIFIER,
            "Barwarden",
            40,
            9,
        );

        assert!(publication_target_is_current(
            Some(&observed),
            &observed,
            true,
        ));
        assert!(!publication_target_is_current(
            Some(&replacement),
            &observed,
            true,
        ));
        assert!(publication_target_is_current(
            Some(&barwarden),
            &observed,
            true,
        ));
        assert!(!publication_target_is_current(
            Some(&barwarden),
            &observed,
            false,
        ));
    }
}
