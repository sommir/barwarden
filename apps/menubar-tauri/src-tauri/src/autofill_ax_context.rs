use crate::accessibility_focus::{
    classify_focused_field, AppIdentity, AxFrame, FallbackEligibility, FocusRejectReason,
    FocusedFieldObservation, FocusedFieldSnapshot, ScreenFrame, AX_SECURE_TEXT_FIELD,
    AX_TEXT_FIELD,
};
use crate::autofill_contract::AutoFillSecretField;
use crate::autofill_field_context::{
    classify_fields, detect_action, DetectedAction, DetectedFieldKind, FieldConfidence,
    SemanticFieldObservation,
};
use crate::frontmost::FrontmostApp;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

#[derive(Clone)]
pub(crate) enum OpaqueAxIdentity {
    #[cfg(target_os = "macos")]
    Native(Arc<NativeAxLogicalIdentity>),
    #[cfg(test)]
    Test(u64),
    #[cfg(not(any(target_os = "macos", test)))]
    Unavailable,
}

#[cfg(target_os = "macos")]
pub(crate) struct NativeAxLogicalIdentity(*const std::ffi::c_void);

#[cfg(target_os = "macos")]
impl NativeAxLogicalIdentity {
    fn retain_borrowed(value: *const std::ffi::c_void) -> Self {
        unsafe { core_foundation::base::CFRetain(value.cast()) };
        Self(value)
    }
}

#[cfg(target_os = "macos")]
impl Drop for NativeAxLogicalIdentity {
    fn drop(&mut self) {
        unsafe { core_foundation::base::CFRelease(self.0.cast()) };
    }
}

// AXUIElementRef is a retained Core Foundation object; CFEqual/retain/release are thread-safe for
// this opaque identity use, and no AX attribute access is performed through the stored pointer.
#[cfg(target_os = "macos")]
unsafe impl Send for NativeAxLogicalIdentity {}
#[cfg(target_os = "macos")]
unsafe impl Sync for NativeAxLogicalIdentity {}

impl PartialEq for OpaqueAxIdentity {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            #[cfg(target_os = "macos")]
            (Self::Native(left), Self::Native(right)) => unsafe {
                core_foundation::base::CFEqual(left.0.cast(), right.0.cast()) != 0
            },
            #[cfg(test)]
            (Self::Test(left), Self::Test(right)) => left == right,
            #[cfg(not(any(target_os = "macos", test)))]
            (Self::Unavailable, Self::Unavailable) => true,
            #[allow(unreachable_patterns)]
            _ => false,
        }
    }
}

impl Eq for OpaqueAxIdentity {}

impl fmt::Debug for OpaqueAxIdentity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("OpaqueAxIdentity(..)")
    }
}

impl OpaqueAxIdentity {
    #[cfg(test)]
    pub(crate) fn for_test(value: u64) -> Self {
        Self::Test(value)
    }
}

const MAX_ANCESTORS: usize = 3;
const MAX_DESCENDANTS: usize = 256;
const MAX_WINDOWS: usize = 16;
const MAX_FIELDS: usize = 20;
const MAX_SEMANTIC_SCALARS: usize = 255;
const OBSERVATION_BUDGET: Duration = Duration::from_millis(50);
const CONTEXT_LIFETIME: Duration = Duration::from_secs(30);
const CONTEXT_CAPACITY: usize = 64;

pub trait AxMetadataPort {
    type Element: Clone + PartialEq;

    fn string(&mut self, element: &Self::Element, attribute: &'static str) -> Option<String>;
    fn element(
        &mut self,
        element: &Self::Element,
        attribute: &'static str,
    ) -> Option<Self::Element>;
    fn elements(
        &mut self,
        element: &Self::Element,
        attribute: &'static str,
        limit: usize,
    ) -> Vec<Self::Element>;
    fn frame(&mut self, element: &Self::Element) -> Option<AxFrame>;
    fn value_settable(&mut self, element: &Self::Element) -> bool;
    fn caret_frame(&mut self, element: &Self::Element) -> Option<AxFrame>;
    fn logical_identity(&self, element: &Self::Element) -> OpaqueAxIdentity;
    fn now(&self) -> Instant;
    fn metadata_valid(&self) -> bool {
        true
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AxContextError {
    Focus(FocusRejectReason),
    OversizedMetadata,
    TimeBudgetExceeded,
    MissingWindow,
    NoWritableField,
}

impl From<FocusRejectReason> for AxContextError {
    fn from(value: FocusRejectReason) -> Self {
        Self::Focus(value)
    }
}

#[derive(Clone, Debug)]
#[allow(dead_code)] // The caret is consumed by the Task 3 pill placement.
pub struct CapturedAxContext {
    pub focused: FocusedFieldSnapshot,
    pub caret_frame: Option<AxFrame>,
    pub fields: Vec<CapturedFieldFingerprint>,
    pub action: DetectedAction,
}

#[allow(dead_code)] // The caret-first anchor is consumed by Task 3.
impl CapturedAxContext {
    pub fn anchor_frame(&self) -> AxFrame {
        self.caret_frame.unwrap_or(self.focused.frame)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct CapturedFieldFingerprint {
    pub process_id: i32,
    pub role: String,
    pub frame: AxFrame,
    pub window_frame: AxFrame,
    pub(crate) container_path: Vec<u16>,
    pub(crate) traversal_path: Vec<u16>,
    pub(crate) window_identity: OpaqueAxIdentity,
    pub(crate) element_identity: OpaqueAxIdentity,
    pub kind: DetectedFieldKind,
    pub secret_field: Option<AutoFillSecretField>,
    pub confidence: FieldConfidence,
    pub focused: bool,
    pub observer_generation: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PresentedFieldKind {
    Username,
    Email,
    Password,
    OneTimeCode,
    Unknown,
}

impl From<DetectedFieldKind> for PresentedFieldKind {
    fn from(value: DetectedFieldKind) -> Self {
        match value {
            DetectedFieldKind::Username => Self::Username,
            DetectedFieldKind::Email => Self::Email,
            DetectedFieldKind::Password => Self::Password,
            DetectedFieldKind::OneTimeCode => Self::OneTimeCode,
            DetectedFieldKind::Unknown => Self::Unknown,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PresentedFieldConfidence {
    High,
    Medium,
    Low,
}

impl From<FieldConfidence> for PresentedFieldConfidence {
    fn from(value: FieldConfidence) -> Self {
        match value {
            FieldConfidence::High => Self::High,
            FieldConfidence::Medium => Self::Medium,
            FieldConfidence::Low => Self::Low,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentedField {
    pub kind: PresentedFieldKind,
    pub confidence: PresentedFieldConfidence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PresentedActionMode {
    Field,
    Form,
    Choose,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentedAction {
    pub mode: PresentedActionMode,
    pub fields: Vec<AutoFillSecretField>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FillContextPresentation {
    pub fill_context_token: String,
    pub focused_field: PresentedField,
    pub action: PresentedAction,
}

#[derive(Clone, Debug)]
#[allow(dead_code)] // Consumed by the Task 4 native fill executor.
pub struct CapturedFillPlan {
    pub target: FrontmostApp,
    pub fields: Vec<CapturedFieldFingerprint>,
    pub action: DetectedAction,
    pub requested: Vec<AutoFillSecretField>,
    pub(crate) bindings: Vec<CapturedFillBinding>,
    pub(crate) observer_generation: ObserverGeneration,
}

#[derive(Clone, Debug)]
pub(crate) struct CapturedFillBinding {
    pub(crate) field: AutoFillSecretField,
    pub(crate) fingerprint: CapturedFieldFingerprint,
}

impl CapturedFillPlan {
    pub(crate) fn fingerprint_for_field(
        &self,
        field: AutoFillSecretField,
    ) -> Option<&CapturedFieldFingerprint> {
        let mut matches = self
            .bindings
            .iter()
            .filter(|binding| binding.field == field);
        let binding = matches.next()?;
        matches.next().is_none().then_some(&binding.fingerprint)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)] // Remaining variants are consumed by the Task 4 fill command.
pub enum DetectedFillError {
    InvalidToken,
    Expired,
    CapacityReached,
    WrongFieldSubset,
    TargetChanged,
    StaleProcess,
    StaleWindow,
    StaleField,
    StaleGeneration,
}

#[derive(Clone, Debug, Default)]
pub struct ObserverGeneration(Arc<AtomicU64>);

impl ObserverGeneration {
    #[cfg(test)]
    pub(crate) fn new(generation: u64) -> Self {
        Self(Arc::new(AtomicU64::new(generation)))
    }

    pub(crate) fn current(&self) -> u64 {
        self.0.load(Ordering::Acquire)
    }

    pub(crate) fn set(&self, generation: u64) {
        self.0.store(generation, Ordering::Release);
    }
}

#[allow(dead_code)] // Read by the Task 4 fill executor through `take`.
struct StoredFillContext {
    target: FrontmostApp,
    fields: Vec<CapturedFieldFingerprint>,
    action: DetectedAction,
    action_bindings: StoredActionBindings,
    deadline: Instant,
}

pub(crate) struct ReservedFillContext(StoredFillContext);

#[derive(Clone)]
enum StoredActionBindings {
    Fixed(Vec<CapturedFillBinding>),
    Choose(CapturedFieldFingerprint),
}

type Clock = dyn Fn() -> Instant + Send + Sync;
type Validator = dyn Fn(&FrontmostApp, &[CapturedFieldFingerprint], u64) -> Result<(), DetectedFillError>
    + Send
    + Sync;

#[derive(Clone)]
pub struct DetectedFillContextStore {
    records: Arc<Mutex<HashMap<String, StoredFillContext>>>,
    clock: Arc<Clock>,
    observer_generation: ObserverGeneration,
    #[allow(dead_code)] // Invoked by `take`, which Task 4 registers on the command surface.
    validator: Arc<Validator>,
}

impl fmt::Debug for DetectedFillContextStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DetectedFillContextStore")
            .finish_non_exhaustive()
    }
}

impl Default for DetectedFillContextStore {
    fn default() -> Self {
        Self::with_observer_generation(ObserverGeneration::default())
    }
}

impl DetectedFillContextStore {
    pub(crate) fn with_observer_generation(observer_generation: ObserverGeneration) -> Self {
        Self {
            records: Arc::new(Mutex::new(HashMap::new())),
            clock: Arc::new(Instant::now),
            observer_generation,
            validator: Arc::new(validate_live_fingerprints),
        }
    }
}

#[allow(dead_code)] // The complete store contract is consumed beginning in Task 4.
impl DetectedFillContextStore {
    pub fn insert(
        &self,
        target: FrontmostApp,
        fields: Vec<CapturedFieldFingerprint>,
        action: DetectedAction,
    ) -> FillContextPresentation {
        let rejected = presentation_for("".to_owned(), &fields, &action);
        self.try_insert(target, fields, action).unwrap_or(rejected)
    }

    pub(crate) fn try_insert(
        &self,
        target: FrontmostApp,
        fields: Vec<CapturedFieldFingerprint>,
        action: DetectedAction,
    ) -> Result<FillContextPresentation, DetectedFillError> {
        validate_inserted_fingerprints(&target, &fields)?;
        let action_bindings =
            capture_action_bindings(&fields, &action).ok_or(DetectedFillError::StaleField)?;
        if fields
            .first()
            .is_none_or(|field| field.observer_generation != self.observer_generation.current())
        {
            return Err(DetectedFillError::StaleGeneration);
        }
        let now = (self.clock)();
        let mut records = self
            .records
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        records.retain(|_, record| now < record.deadline);
        if records.len() >= CONTEXT_CAPACITY {
            return Err(DetectedFillError::CapacityReached);
        }
        let token = uuid::Uuid::new_v4().to_string();
        let presentation = presentation_for(token.clone(), &fields, &action);
        records.insert(
            token,
            StoredFillContext {
                target,
                fields,
                action,
                action_bindings,
                deadline: now + CONTEXT_LIFETIME,
            },
        );
        Ok(presentation)
    }

    pub fn take(
        &self,
        token: &str,
        requested: &[AutoFillSecretField],
    ) -> Result<CapturedFillPlan, DetectedFillError> {
        let reserved = self.reserve_identified(token)?;
        self.validate_reserved(reserved, requested)
    }

    pub fn take_explicit(
        &self,
        token: &str,
        requested: AutoFillSecretField,
    ) -> Result<CapturedFillPlan, DetectedFillError> {
        let reserved = self.reserve_identified(token)?;
        self.validate_reserved_explicit(reserved, requested)
    }

    pub(crate) fn reserve_identified(
        &self,
        token: &str,
    ) -> Result<ReservedFillContext, DetectedFillError> {
        let record = self
            .records
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(token)
            .ok_or(DetectedFillError::InvalidToken)?;
        if (self.clock)() >= record.deadline {
            return Err(DetectedFillError::Expired);
        }
        Ok(ReservedFillContext(record))
    }

    pub(crate) fn validate_reserved(
        &self,
        reserved: ReservedFillContext,
        requested: &[AutoFillSecretField],
    ) -> Result<CapturedFillPlan, DetectedFillError> {
        let mut record = reserved.0;
        if bindings_for_request(requested, &record.action, &record.action_bindings).is_none() {
            return Err(DetectedFillError::WrongFieldSubset);
        }
        let generation = self.observer_generation.current();
        (self.validator)(&record.target, &record.fields, generation)?;
        if self.observer_generation.current() != generation {
            return Err(DetectedFillError::StaleGeneration);
        }
        for field in &mut record.fields {
            field.observer_generation = generation;
        }
        let rebound = capture_action_bindings(&record.fields, &record.action)
            .ok_or(DetectedFillError::StaleField)?;
        let bindings = bindings_for_request(requested, &record.action, &rebound)
            .ok_or(DetectedFillError::WrongFieldSubset)?;
        Ok(CapturedFillPlan {
            target: record.target,
            fields: record.fields,
            action: record.action,
            requested: requested.to_vec(),
            bindings,
            observer_generation: self.observer_generation.clone(),
        })
    }

    pub(crate) fn validate_reserved_explicit(
        &self,
        reserved: ReservedFillContext,
        requested: AutoFillSecretField,
    ) -> Result<CapturedFillPlan, DetectedFillError> {
        let mut record = reserved.0;
        let generation = self.observer_generation.current();
        (self.validator)(&record.target, &record.fields, generation)?;
        if self.observer_generation.current() != generation {
            return Err(DetectedFillError::StaleGeneration);
        }
        for field in &mut record.fields {
            field.observer_generation = generation;
        }
        let mut focused = record.fields.iter().filter(|field| field.focused);
        let fingerprint = focused
            .next()
            .cloned()
            .ok_or(DetectedFillError::StaleField)?;
        if focused.next().is_some() {
            return Err(DetectedFillError::StaleField);
        }
        Ok(CapturedFillPlan {
            target: record.target,
            fields: record.fields,
            action: record.action,
            requested: vec![requested],
            bindings: vec![CapturedFillBinding {
                field: requested,
                fingerprint,
            }],
            observer_generation: self.observer_generation.clone(),
        })
    }

    pub fn invalidate_all(&self) {
        self.records
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }

    pub(crate) fn burn(&self, token: &str) -> bool {
        self.records
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(token)
            .is_some()
    }

    pub(crate) fn current_observer_generation(&self) -> u64 {
        self.observer_generation.current()
    }

    #[cfg(test)]
    fn for_test(
        clock: impl Fn() -> Instant + Send + Sync + 'static,
        validator: impl Fn(&FrontmostApp, &[CapturedFieldFingerprint]) -> Result<(), DetectedFillError>
            + Send
            + Sync
            + 'static,
    ) -> Self {
        Self::for_test_with_generation(
            ObserverGeneration::new(7),
            clock,
            move |target, fields, _| validator(target, fields),
        )
    }

    #[cfg(test)]
    pub(crate) fn for_test_with_generation(
        observer_generation: ObserverGeneration,
        clock: impl Fn() -> Instant + Send + Sync + 'static,
        validator: impl Fn(&FrontmostApp, &[CapturedFieldFingerprint], u64) -> Result<(), DetectedFillError>
            + Send
            + Sync
            + 'static,
    ) -> Self {
        Self {
            records: Arc::new(Mutex::new(HashMap::new())),
            clock: Arc::new(clock),
            observer_generation,
            validator: Arc::new(validator),
        }
    }
}

fn validate_inserted_fingerprints(
    target: &FrontmostApp,
    fields: &[CapturedFieldFingerprint],
) -> Result<(), DetectedFillError> {
    if fields
        .iter()
        .any(|field| field.process_id != target.process_id)
    {
        return Err(DetectedFillError::StaleProcess);
    }
    let Some(first) = fields.first() else {
        return Err(DetectedFillError::StaleField);
    };
    if fields.len() > MAX_FIELDS
        || fields.iter().filter(|field| field.focused).count() != 1
        || has_duplicate_element_identity(fields)
        || fields.iter().any(|field| {
            field.observer_generation != first.observer_generation
                || !valid_frame(&field.frame)
                || !is_text_role(Some(&field.role), None)
        })
    {
        return Err(DetectedFillError::StaleField);
    }
    if !valid_frame(&first.window_frame)
        || fields.iter().any(|field| {
            field.window_frame != first.window_frame
                || field.window_identity != first.window_identity
        })
    {
        return Err(DetectedFillError::StaleWindow);
    }
    Ok(())
}

fn has_duplicate_element_identity(fields: &[CapturedFieldFingerprint]) -> bool {
    fields.iter().enumerate().any(|(index, field)| {
        fields[..index]
            .iter()
            .any(|previous| previous.element_identity == field.element_identity)
    })
}

#[allow(dead_code)] // Called by `take`, which Task 4 registers on the command surface.
fn requested_fields_allowed(
    requested: &[AutoFillSecretField],
    fields: &[CapturedFieldFingerprint],
    action: &DetectedAction,
) -> bool {
    capture_action_bindings(fields, action)
        .and_then(|bindings| bindings_for_request(requested, action, &bindings))
        .is_some()
}

fn capture_action_bindings(
    fields: &[CapturedFieldFingerprint],
    action: &DetectedAction,
) -> Option<StoredActionBindings> {
    match action {
        DetectedAction::Field { field } => {
            resolve_action_bindings(&[*field], fields, action).map(StoredActionBindings::Fixed)
        }
        DetectedAction::Form { fields: allowed } => {
            resolve_action_bindings(allowed, fields, action).map(StoredActionBindings::Fixed)
        }
        DetectedAction::Choose => {
            let mut focused = fields.iter().filter(|field| field.focused);
            let fingerprint = focused.next()?;
            if focused.next().is_some() {
                return None;
            }
            Some(StoredActionBindings::Choose(fingerprint.clone()))
        }
    }
}

fn bindings_for_request(
    requested: &[AutoFillSecretField],
    action: &DetectedAction,
    captured: &StoredActionBindings,
) -> Option<Vec<CapturedFillBinding>> {
    if requested.is_empty()
        || requested.len() > 3
        || requested
            .iter()
            .enumerate()
            .any(|(index, field)| requested[..index].contains(field))
    {
        return None;
    }
    match (action, captured) {
        (DetectedAction::Field { field }, StoredActionBindings::Fixed(bindings))
            if requested == [*field] =>
        {
            Some(bindings.clone())
        }
        (DetectedAction::Form { fields: allowed }, StoredActionBindings::Fixed(bindings))
            if requested.iter().all(|field| allowed.contains(field)) =>
        {
            let mut result = Vec::with_capacity(requested.len());
            for field in requested {
                let mut matches = bindings.iter().filter(|binding| binding.field == *field);
                let binding = matches.next()?;
                if matches.next().is_some() {
                    return None;
                }
                result.push(binding.clone());
            }
            Some(result)
        }
        (DetectedAction::Choose, StoredActionBindings::Choose(fingerprint))
            if requested.len() == 1 =>
        {
            Some(vec![CapturedFillBinding {
                field: requested[0],
                fingerprint: fingerprint.clone(),
            }])
        }
        _ => None,
    }
}

fn resolve_action_bindings(
    requested: &[AutoFillSecretField],
    fields: &[CapturedFieldFingerprint],
    action: &DetectedAction,
) -> Option<Vec<CapturedFillBinding>> {
    if requested.is_empty()
        || requested.len() > 3
        || requested
            .iter()
            .enumerate()
            .any(|(index, field)| requested[..index].contains(field))
    {
        return None;
    }
    let bound = match action {
        DetectedAction::Field { field } if requested == [*field] => {
            let mut matches = fields
                .iter()
                .filter(|captured| captured.focused && captured.secret_field == Some(*field));
            let fingerprint = matches.next()?;
            if matches.next().is_some() {
                return None;
            }
            vec![CapturedFillBinding {
                field: *field,
                fingerprint: fingerprint.clone(),
            }]
        }
        DetectedAction::Form { fields: allowed }
            if requested.iter().all(|field| allowed.contains(field)) =>
        {
            let mut paths = fields
                .iter()
                .map(|field| field.container_path.as_slice())
                .filter(|path| !path.is_empty())
                .collect::<Vec<_>>();
            paths.sort_unstable();
            paths.dedup();
            let mut matching_groups = Vec::new();
            for path in paths {
                let group = fields
                    .iter()
                    .filter(|field| field.container_path == path)
                    .collect::<Vec<_>>();
                if group.iter().filter(|field| field.focused).count() != 1 {
                    continue;
                }
                let mut group_fields = group
                    .iter()
                    .filter_map(|field| field.secret_field)
                    .collect::<Vec<_>>();
                group_fields.sort_unstable();
                let mut canonical_allowed = allowed.clone();
                canonical_allowed.sort_unstable();
                if group_fields != canonical_allowed
                    || group_fields.windows(2).any(|pair| pair[0] == pair[1])
                {
                    continue;
                }
                let mut bindings = Vec::with_capacity(requested.len());
                for requested_field in requested {
                    let mut matches = group
                        .iter()
                        .filter(|captured| captured.secret_field == Some(*requested_field));
                    let fingerprint = *matches.next()?;
                    if matches.next().is_some() {
                        return None;
                    }
                    bindings.push(CapturedFillBinding {
                        field: *requested_field,
                        fingerprint: fingerprint.clone(),
                    });
                }
                matching_groups.push(bindings);
            }
            if matching_groups.len() != 1 {
                return None;
            }
            matching_groups.pop()?
        }
        DetectedAction::Choose if requested.len() == 1 => {
            let mut focused = fields.iter().filter(|field| field.focused);
            let fingerprint = focused.next()?;
            if focused.next().is_some() {
                return None;
            }
            vec![CapturedFillBinding {
                field: requested[0],
                fingerprint: fingerprint.clone(),
            }]
        }
        _ => return None,
    };
    Some(bound)
}

fn presentation_for(
    token: String,
    fields: &[CapturedFieldFingerprint],
    action: &DetectedAction,
) -> FillContextPresentation {
    let focused = fields.iter().find(|field| field.focused);
    let focused_field = focused.map_or(
        PresentedField {
            kind: PresentedFieldKind::Unknown,
            confidence: PresentedFieldConfidence::Low,
        },
        |field| PresentedField {
            kind: field.kind.into(),
            confidence: field.confidence.into(),
        },
    );
    let action = match action {
        DetectedAction::Field { field } => PresentedAction {
            mode: PresentedActionMode::Field,
            fields: vec![*field],
        },
        DetectedAction::Form { fields } => PresentedAction {
            mode: PresentedActionMode::Form,
            fields: fields.clone(),
        },
        DetectedAction::Choose => PresentedAction {
            mode: PresentedActionMode::Choose,
            fields: Vec::new(),
        },
    };
    FillContextPresentation {
        fill_context_token: token,
        focused_field,
        action,
    }
}

fn validate_live_fingerprints(
    target: &FrontmostApp,
    fields: &[CapturedFieldFingerprint],
    observer_generation: u64,
) -> Result<(), DetectedFillError> {
    let current =
        crate::frontmost::current_frontmost_app().map_err(|_| DetectedFillError::TargetChanged)?;
    if !frontmost_allows_live_fill(current.as_ref(), target) {
        return Err(DetectedFillError::TargetChanged);
    }
    if !crate::frontmost::target_is_running(target) {
        return Err(DetectedFillError::TargetChanged);
    }
    if fields
        .iter()
        .any(|field| field.process_id != target.process_id)
    {
        return Err(DetectedFillError::StaleProcess);
    }
    validate_native_fingerprints(target, fields, observer_generation)
}

fn frontmost_allows_live_fill(current: Option<&FrontmostApp>, target: &FrontmostApp) -> bool {
    current.is_some_and(|current| {
        current == target || current.bundle_id == crate::frontmost::APP_BUNDLE_ID
    })
}

#[cfg(not(target_os = "macos"))]
fn validate_native_fingerprints(
    _target: &FrontmostApp,
    _fields: &[CapturedFieldFingerprint],
    _observer_generation: u64,
) -> Result<(), DetectedFillError> {
    Ok(())
}

fn validate_current_fingerprints(
    stored: &[CapturedFieldFingerprint],
    current: &[CapturedFieldFingerprint],
    observer_generation: u64,
) -> Result<(), DetectedFillError> {
    let Some(stored_generation) = stored.first().map(|field| field.observer_generation) else {
        return Err(DetectedFillError::StaleField);
    };
    if stored
        .iter()
        .any(|field| field.observer_generation != stored_generation)
        || current
            .iter()
            .any(|field| field.observer_generation != observer_generation)
    {
        return Err(DetectedFillError::StaleGeneration);
    }
    if stored.len() != current.len() {
        return Err(DetectedFillError::StaleField);
    }
    if has_duplicate_element_identity(stored) || has_duplicate_element_identity(current) {
        return Err(DetectedFillError::StaleField);
    }
    let mut matched = vec![false; current.len()];
    for stored_expected in stored {
        let mut expected = stored_expected.clone();
        expected.observer_generation = observer_generation;
        let Some(index) = current
            .iter()
            .enumerate()
            .position(|(index, actual)| !matched[index] && actual == &expected)
        else {
            if current.iter().any(|actual| {
                actual.window_frame != expected.window_frame
                    || actual.window_identity != expected.window_identity
            }) {
                return Err(DetectedFillError::StaleWindow);
            }
            return Err(DetectedFillError::StaleField);
        };
        matched[index] = true;
    }
    Ok(())
}

fn recapture_fingerprints_from_application<P: AxMetadataPort>(
    port: &mut P,
    application: P::Element,
    target: FrontmostApp,
    screens: &[ScreenFrame],
    stored: &[CapturedFieldFingerprint],
    observer_generation: u64,
) -> Result<(CapturedAxContext, Vec<P::Element>), DetectedFillError> {
    let mut focused = stored.iter().filter(|field| field.focused);
    let stored_focused = focused.next().ok_or(DetectedFillError::StaleField)?;
    if focused.next().is_some() {
        return Err(DetectedFillError::StaleField);
    }

    let windows = port.elements(&application, "AXWindows", MAX_WINDOWS);
    ensure_metadata_valid(port).map_err(|_| DetectedFillError::StaleWindow)?;
    let mut matching_windows = windows
        .into_iter()
        .filter(|window| port.logical_identity(window) == stored_focused.window_identity);
    let window = matching_windows
        .next()
        .ok_or(DetectedFillError::StaleWindow)?;
    if matching_windows.next().is_some() {
        return Err(DetectedFillError::StaleWindow);
    }

    let mut queue = VecDeque::from([window]);
    let mut inspected = 0_usize;
    let mut exact_focused = None;
    while let Some(element) = queue.pop_front() {
        if inspected >= MAX_DESCENDANTS {
            break;
        }
        inspected += 1;
        if port.logical_identity(&element) == stored_focused.element_identity {
            if exact_focused.replace(element.clone()).is_some() {
                return Err(DetectedFillError::StaleField);
            }
        }
        let remaining = MAX_DESCENDANTS.saturating_sub(inspected + queue.len());
        if remaining == 0 {
            continue;
        }
        queue.extend(port.elements(&element, "AXChildren", remaining));
        ensure_metadata_valid(port).map_err(|_| DetectedFillError::StaleField)?;
    }
    let exact_focused = exact_focused.ok_or(DetectedFillError::StaleField)?;
    let (current, elements) =
        capture_with_port_and_elements(port, exact_focused, target, screens, observer_generation)
            .map_err(|_| DetectedFillError::StaleField)?;
    validate_current_fingerprints(stored, &current.fields, observer_generation)?;
    Ok((current, elements))
}

fn validate_fingerprints_from_application<P: AxMetadataPort>(
    port: &mut P,
    application: P::Element,
    target: FrontmostApp,
    screens: &[ScreenFrame],
    stored: &[CapturedFieldFingerprint],
    observer_generation: u64,
) -> Result<(), DetectedFillError> {
    recapture_fingerprints_from_application(
        port,
        application,
        target,
        screens,
        stored,
        observer_generation,
    )
    .map(|_| ())
}

pub(crate) fn exact_fill_element_index(
    stored: &[CapturedFieldFingerprint],
    current: &[CapturedFieldFingerprint],
    expected: &CapturedFieldFingerprint,
    observer_generation: u64,
) -> Result<usize, crate::autofill_detected_fill::ExactAxFillError> {
    use crate::autofill_detected_fill::ExactAxFillError;

    if stored
        .iter()
        .chain(current)
        .any(|field| field.observer_generation != observer_generation)
    {
        return Err(ExactAxFillError::GenerationChanged);
    }
    if stored
        .iter()
        .chain(current)
        .any(|field| field.process_id != expected.process_id)
    {
        return Err(ExactAxFillError::ProcessChanged);
    }
    if stored.iter().chain(current).any(|field| {
        field.window_frame != expected.window_frame
            || field.window_identity != expected.window_identity
    }) {
        return Err(ExactAxFillError::WindowChanged);
    }
    validate_current_fingerprints(stored, current, observer_generation)
        .map_err(|_| ExactAxFillError::FrameChanged)?;
    let mut matches = current
        .iter()
        .enumerate()
        .filter(|(_, field)| *field == expected);
    let (index, _) = matches.next().ok_or(ExactAxFillError::FrameChanged)?;
    if matches.next().is_some() {
        return Err(ExactAxFillError::FrameChanged);
    }
    Ok(index)
}

fn inspect_bounded_child_entries<T>(
    entries: &[T],
    limit: usize,
    mut valid: impl FnMut(&T) -> bool,
) -> Result<usize, usize> {
    let mut inspected = 0;
    for entry in entries.iter().take(limit) {
        inspected += 1;
        if !valid(entry) {
            return Err(inspected);
        }
    }
    Ok(inspected)
}

struct ClipboardFlavorSnapshot {
    type_name: String,
    data: Zeroizing<Vec<u8>>,
}

struct ClipboardItemSnapshot {
    flavors: Vec<ClipboardFlavorSnapshot>,
}

struct ClipboardSnapshot {
    items: Vec<ClipboardItemSnapshot>,
}

impl ClipboardSnapshot {
    #[cfg(test)]
    fn from_plain_items(items: Vec<Vec<(String, Vec<u8>)>>) -> Self {
        Self {
            items: items
                .into_iter()
                .map(|flavors| ClipboardItemSnapshot {
                    flavors: flavors
                        .into_iter()
                        .map(|(type_name, data)| ClipboardFlavorSnapshot {
                            type_name,
                            data: Zeroizing::new(data),
                        })
                        .collect(),
                })
                .collect(),
        }
    }

    #[cfg(test)]
    fn to_plain_items(&self) -> Vec<Vec<(String, Vec<u8>)>> {
        self.items
            .iter()
            .map(|item| {
                item.flavors
                    .iter()
                    .map(|flavor| (flavor.type_name.clone(), flavor.data.to_vec()))
                    .collect()
            })
            .collect()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ClipboardRestoreDisposition {
    Restored,
    ExternalMutationPreserved,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ClipboardWriteError {
    Untouched,
    Owned(isize),
}

trait SecureClipboardPort {
    fn snapshot_all(&mut self) -> Result<ClipboardSnapshot, ()>;
    fn write_secret(&mut self, value: &str) -> Result<isize, ClipboardWriteError>;
    fn restore_if_unchanged(
        &mut self,
        owned_generation: isize,
        snapshot: &ClipboardSnapshot,
    ) -> Result<ClipboardRestoreDisposition, ()>;
    fn clear_if_unchanged(&mut self, owned_generation: isize) -> Result<bool, ()>;
}

struct ClipboardRestorationGuard<'a, P: SecureClipboardPort> {
    clipboard: &'a mut P,
    snapshot: Option<ClipboardSnapshot>,
    owned_generation: Option<isize>,
}

impl<P: SecureClipboardPort> ClipboardRestorationGuard<'_, P> {
    fn cleanup(&mut self) -> Result<(), ()> {
        let Some(owned_generation) = self.owned_generation.take() else {
            return Ok(());
        };
        let Some(snapshot) = self.snapshot.take() else {
            return Ok(());
        };
        match self
            .clipboard
            .restore_if_unchanged(owned_generation, &snapshot)
        {
            Ok(
                ClipboardRestoreDisposition::Restored
                | ClipboardRestoreDisposition::ExternalMutationPreserved,
            ) => Ok(()),
            Err(()) => {
                let _ = self.clipboard.clear_if_unchanged(owned_generation);
                Err(())
            }
        }
    }
}

impl<P: SecureClipboardPort> Drop for ClipboardRestorationGuard<'_, P> {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

static CLIPBOARD_TRANSACTION_LOCK: Mutex<()> = Mutex::new(());
const PASTE_EVENT_ENQUEUE_DEADLINE: Duration = Duration::from_millis(250);
const PASTE_POST_ENQUEUE_GRACE: Duration = Duration::from_millis(250);

trait PasteClockWaitPort {
    fn now(&mut self) -> Instant;
    fn wait_for(&mut self, duration: Duration) -> Result<(), ()>;
}

struct SystemPasteClockWait;

impl PasteClockWaitPort for SystemPasteClockWait {
    fn now(&mut self) -> Instant {
        Instant::now()
    }

    fn wait_for(&mut self, duration: Duration) -> Result<(), ()> {
        std::thread::sleep(duration);
        Ok(())
    }
}

fn exact_paste_event_with(
    deadline: Instant,
    mut focus: impl FnMut() -> Result<(), ()>,
    mut revalidate: impl FnMut() -> Result<(), ()>,
    mut post_and_confirm_enqueued: impl FnMut() -> Result<(), ()>,
    mut now: impl FnMut() -> Instant,
) -> Result<(), ()> {
    if now() > deadline {
        return Err(());
    }
    focus()?;
    revalidate()?;
    if now() > deadline {
        return Err(());
    }
    revalidate()?;
    post_and_confirm_enqueued()?;
    (now() <= deadline).then_some(()).ok_or(())
}

fn guarded_paste_transaction<P: SecureClipboardPort>(
    clipboard: &mut P,
    value: &str,
    focus_revalidate_and_post: impl FnMut(Instant) -> Result<(), ()>,
) -> Result<(), ()> {
    guarded_paste_transaction_with_wait(
        clipboard,
        value,
        focus_revalidate_and_post,
        &mut SystemPasteClockWait,
    )
}

fn guarded_paste_transaction_with_wait<P: SecureClipboardPort, W: PasteClockWaitPort>(
    clipboard: &mut P,
    value: &str,
    focus_revalidate_and_post: impl FnMut(Instant) -> Result<(), ()>,
    clock_wait: &mut W,
) -> Result<(), ()> {
    guarded_paste_transaction_with_wait_and_lock(
        clipboard,
        value,
        focus_revalidate_and_post,
        clock_wait,
        &CLIPBOARD_TRANSACTION_LOCK,
    )
}

fn guarded_paste_transaction_with_wait_and_lock<P: SecureClipboardPort, W: PasteClockWaitPort>(
    clipboard: &mut P,
    value: &str,
    mut focus_revalidate_and_post: impl FnMut(Instant) -> Result<(), ()>,
    clock_wait: &mut W,
    transaction_lock: &Mutex<()>,
) -> Result<(), ()> {
    let _serialized = transaction_lock
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let snapshot = clipboard.snapshot_all()?;
    let mut guard = ClipboardRestorationGuard {
        clipboard,
        snapshot: Some(snapshot),
        owned_generation: None,
    };
    guard.owned_generation = match guard.clipboard.write_secret(value) {
        Ok(generation) => Some(generation),
        Err(ClipboardWriteError::Untouched) => return Err(()),
        Err(ClipboardWriteError::Owned(generation)) => {
            guard.owned_generation = Some(generation);
            return Err(());
        }
    };
    let event_started = clock_wait.now();
    let deadline = event_started
        .checked_add(PASTE_EVENT_ENQUEUE_DEADLINE)
        .ok_or(())?;
    if focus_revalidate_and_post(deadline).is_err() {
        return Err(());
    }
    let enqueued_at = clock_wait.now();
    if enqueued_at.checked_duration_since(event_started).is_none() || enqueued_at > deadline {
        return Err(());
    }
    // CGEventPostToPid has no target-consumption acknowledgement. Keep the concealed transient
    // pasteboard value owned for this bounded grace after enqueue, then restore through the guard.
    if clock_wait.wait_for(PASTE_POST_ENQUEUE_GRACE).is_err() {
        return Err(());
    }
    let grace_completed_at = clock_wait.now();
    if grace_completed_at
        .checked_duration_since(enqueued_at)
        .filter(|elapsed| *elapsed >= PASTE_POST_ENQUEUE_GRACE)
        .is_none()
    {
        return Err(());
    }
    guard.cleanup()
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use crate::accessibility_focus::{validate_ax_value_with, validate_copied_type_with};
    use core_foundation::array::{CFArrayGetCount, CFArrayGetTypeID, CFArrayGetValueAtIndex};
    use core_foundation::base::{
        CFGetTypeID, CFIndex, CFRange, CFRelease, CFRetain, CFTypeID, CFTypeRef, TCFType,
    };
    use core_foundation::boolean::CFBoolean;
    use core_foundation::string::{
        kCFStringEncodingUTF8, CFString, CFStringGetBytes, CFStringGetLength, CFStringRef,
    };
    use core_graphics::display::CGDisplay;
    use core_graphics::event::{CGEvent, CGEventFlags};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::geometry::{CGPoint, CGRect, CGSize};
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSPasteboard, NSPasteboardItem, NSPasteboardTypeString, NSPasteboardWriting,
    };
    use objc2_foundation::{NSArray, NSData, NSString};
    use std::ffi::c_void;
    use std::ptr;

    type AXUIElementRef = *const c_void;
    type AXValueRef = *const c_void;
    type AXError = i32;

    const AX_ERROR_SUCCESS: AXError = 0;
    const AX_ERROR_ATTRIBUTE_UNSUPPORTED: AXError = -25205;
    const AX_ERROR_NOT_IMPLEMENTED: AXError = -25208;
    const AX_VALUE_CGPOINT: i32 = 1;
    const AX_VALUE_CGSIZE: i32 = 2;
    const AX_VALUE_CGRECT: i32 = 3;
    const AX_VALUE_CFRANGE: i32 = 4;
    const MAX_UTF16_UNITS: CFIndex = (MAX_SEMANTIC_SCALARS * 2) as CFIndex;
    const MAX_UTF8_BYTES: usize = MAX_SEMANTIC_SCALARS * 4;
    const MAX_CLIPBOARD_ITEMS: usize = 128;
    const MAX_CLIPBOARD_FLAVORS: usize = 256;
    const MAX_CLIPBOARD_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;

    struct NativeSecureClipboard {
        pasteboard: Retained<NSPasteboard>,
    }

    impl NativeSecureClipboard {
        fn new() -> Self {
            Self {
                pasteboard: NSPasteboard::generalPasteboard(),
            }
        }

        fn restore_items_if_unchanged(
            &self,
            snapshot: &ClipboardSnapshot,
            owned_generation: isize,
        ) -> Result<ClipboardRestoreDisposition, ()> {
            let mut items = Vec::with_capacity(snapshot.items.len());
            for item_snapshot in &snapshot.items {
                let item = NSPasteboardItem::new();
                for flavor in &item_snapshot.flavors {
                    let type_name = NSString::from_str(&flavor.type_name);
                    let data = NSData::with_bytes(&flavor.data);
                    if !item.setData_forType(&data, &type_name) {
                        return Err(());
                    }
                }
                items.push(ProtocolObject::<dyn NSPasteboardWriting>::from_retained(
                    item,
                ));
            }
            let items = NSArray::from_retained_slice(&items);
            if self.pasteboard.changeCount() != owned_generation {
                return Ok(ClipboardRestoreDisposition::ExternalMutationPreserved);
            }
            self.pasteboard.clearContents();
            self.pasteboard
                .writeObjects(&items)
                .then_some(ClipboardRestoreDisposition::Restored)
                .ok_or(())
        }
    }

    impl SecureClipboardPort for NativeSecureClipboard {
        fn snapshot_all(&mut self) -> Result<ClipboardSnapshot, ()> {
            let Some(items) = self.pasteboard.pasteboardItems() else {
                return Ok(ClipboardSnapshot { items: Vec::new() });
            };
            if items.count() > MAX_CLIPBOARD_ITEMS {
                return Err(());
            }
            let mut total_flavors = 0_usize;
            let mut total_bytes = 0_usize;
            let mut snapshot_items = Vec::with_capacity(items.count());
            for item_index in 0..items.count() {
                let item = items.objectAtIndex(item_index);
                let types = item.types();
                total_flavors = total_flavors.checked_add(types.count()).ok_or(())?;
                if total_flavors > MAX_CLIPBOARD_FLAVORS {
                    return Err(());
                }
                let mut flavors = Vec::with_capacity(types.count());
                for type_index in 0..types.count() {
                    let type_name = types.objectAtIndex(type_index);
                    let data = item.dataForType(&type_name).ok_or(())?.to_vec();
                    total_bytes = total_bytes.checked_add(data.len()).ok_or(())?;
                    if total_bytes > MAX_CLIPBOARD_SNAPSHOT_BYTES {
                        return Err(());
                    }
                    flavors.push(ClipboardFlavorSnapshot {
                        type_name: type_name.to_string(),
                        data: Zeroizing::new(data),
                    });
                }
                snapshot_items.push(ClipboardItemSnapshot { flavors });
            }
            Ok(ClipboardSnapshot {
                items: snapshot_items,
            })
        }

        fn write_secret(&mut self, value: &str) -> Result<isize, ClipboardWriteError> {
            let item = NSPasteboardItem::new();
            let value = NSString::from_str(value);
            if !item.setString_forType(&value, unsafe { NSPasteboardTypeString }) {
                return Err(ClipboardWriteError::Untouched);
            }
            let empty = NSData::with_bytes(&[]);
            for marker in [
                "org.nspasteboard.TransientType",
                "org.nspasteboard.ConcealedType",
            ] {
                let marker = NSString::from_str(marker);
                if !item.setData_forType(&empty, &marker) {
                    return Err(ClipboardWriteError::Untouched);
                }
            }
            let item = ProtocolObject::<dyn NSPasteboardWriting>::from_retained(item);
            let items = NSArray::from_retained_slice(&[item]);
            self.pasteboard.clearContents();
            if !self.pasteboard.writeObjects(&items) {
                return Err(ClipboardWriteError::Owned(self.pasteboard.changeCount()));
            }
            Ok(self.pasteboard.changeCount())
        }

        fn restore_if_unchanged(
            &mut self,
            owned_generation: isize,
            snapshot: &ClipboardSnapshot,
        ) -> Result<ClipboardRestoreDisposition, ()> {
            self.restore_items_if_unchanged(snapshot, owned_generation)
        }

        fn clear_if_unchanged(&mut self, owned_generation: isize) -> Result<bool, ()> {
            if self.pasteboard.changeCount() != owned_generation {
                return Ok(false);
            }
            self.pasteboard.clearContents();
            Ok(true)
        }
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementGetTypeID() -> CFTypeID;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementCopyAttributeValues(
            element: AXUIElementRef,
            attribute: CFStringRef,
            index: CFIndex,
            max_values: CFIndex,
            values: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementCopyParameterizedAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            parameter: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementIsAttributeSettable(
            element: AXUIElementRef,
            attribute: CFStringRef,
            settable: *mut bool,
        ) -> AXError;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: CFTypeRef,
        ) -> AXError;
        fn AXValueGetValue(value: AXValueRef, value_type: i32, output: *mut c_void) -> bool;
        fn AXValueGetTypeID() -> CFTypeID;
        fn AXValueGetType(value: AXValueRef) -> i32;
    }

    #[derive(Debug)]
    pub struct NativeAxElement(AXUIElementRef);

    impl PartialEq for NativeAxElement {
        fn eq(&self, other: &Self) -> bool {
            unsafe { core_foundation::base::CFEqual(self.0.cast(), other.0.cast()) != 0 }
        }
    }

    impl Eq for NativeAxElement {}

    impl Clone for NativeAxElement {
        fn clone(&self) -> Self {
            unsafe { CFRetain(self.0.cast()) };
            Self(self.0)
        }
    }

    impl Drop for NativeAxElement {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0.cast()) };
        }
    }

    pub struct NativeAxMetadataPort {
        descendants_inspected: usize,
        invalid_metadata: bool,
    }

    impl NativeAxMetadataPort {
        fn new() -> Self {
            Self {
                descendants_inspected: 0,
                invalid_metadata: false,
            }
        }

        fn copy_attribute(
            &self,
            element: &NativeAxElement,
            attribute: &'static str,
        ) -> Option<CFTypeRef> {
            let attribute = CFString::from_static_string(attribute);
            let mut value = ptr::null();
            let status = unsafe {
                AXUIElementCopyAttributeValue(
                    element.0,
                    attribute.as_concrete_TypeRef(),
                    &mut value,
                )
            };
            (status == AX_ERROR_SUCCESS && !value.is_null()).then_some(value)
        }

        fn ax_value(
            &mut self,
            element: &NativeAxElement,
            attribute: &'static str,
            expected_type: i32,
        ) -> Option<CFTypeRef> {
            let value = self.copy_attribute(element, attribute)?;
            let validated = unsafe {
                validate_ax_value_with(
                    value,
                    AXValueGetTypeID(),
                    expected_type,
                    |value| CFGetTypeID(value.cast()),
                    |value| AXValueGetType(value.cast()),
                    |value| CFRelease(value.cast()),
                )
            };
            if validated.is_none() {
                self.invalid_metadata = true;
            }
            validated
        }
    }

    impl AxMetadataPort for NativeAxMetadataPort {
        type Element = NativeAxElement;

        fn string(&mut self, element: &Self::Element, attribute: &'static str) -> Option<String> {
            let value = self.copy_attribute(element, attribute)?;
            if attribute == "AXEnabled" {
                let validated = unsafe {
                    validate_copied_type_with(
                        value,
                        CFBoolean::type_id(),
                        |value| CFGetTypeID(value.cast()),
                        |value| CFRelease(value.cast()),
                    )
                };
                let Some(value) = validated else {
                    self.invalid_metadata = true;
                    return None;
                };
                let enabled =
                    unsafe { bool::from(CFBoolean::wrap_under_create_rule(value.cast())) };
                return Some(if enabled { "true" } else { "false" }.to_owned());
            }
            let validated = unsafe {
                validate_copied_type_with(
                    value,
                    CFString::type_id(),
                    |value| CFGetTypeID(value.cast()),
                    |value| CFRelease(value.cast()),
                )
            };
            let Some(value) = validated else {
                self.invalid_metadata = true;
                return None;
            };
            let string = bounded_native_string(value.cast());
            if string.is_none() {
                self.invalid_metadata = true;
            }
            string
        }

        fn element(
            &mut self,
            element: &Self::Element,
            attribute: &'static str,
        ) -> Option<Self::Element> {
            let value = self.copy_attribute(element, attribute)?;
            let validated = unsafe {
                validate_copied_type_with(
                    value,
                    AXUIElementGetTypeID(),
                    |value| CFGetTypeID(value.cast()),
                    |value| CFRelease(value.cast()),
                )
            };
            if validated.is_none() {
                self.invalid_metadata = true;
            }
            validated.map(|value| NativeAxElement(value.cast()))
        }

        fn elements(
            &mut self,
            element: &Self::Element,
            attribute: &'static str,
            limit: usize,
        ) -> Vec<Self::Element> {
            if limit == 0 {
                return Vec::new();
            }
            let attribute = CFString::from_static_string(attribute);
            let mut value = ptr::null();
            let status = unsafe {
                AXUIElementCopyAttributeValues(
                    element.0,
                    attribute.as_concrete_TypeRef(),
                    0,
                    limit.min(MAX_DESCENDANTS) as CFIndex,
                    &mut value,
                )
            };
            if status != AX_ERROR_SUCCESS {
                if !value.is_null() {
                    unsafe { CFRelease(value.cast()) };
                }
                return Vec::new();
            }
            if value.is_null() {
                return Vec::new();
            }
            let Some(value) = (unsafe {
                validate_copied_type_with(
                    value,
                    CFArrayGetTypeID(),
                    |value| CFGetTypeID(value.cast()),
                    |value| CFRelease(value.cast()),
                )
            }) else {
                self.invalid_metadata = true;
                return Vec::new();
            };
            let count = unsafe { CFArrayGetCount(value.cast()) }
                .max(0)
                .min(limit as CFIndex) as usize;
            let entries = (0..count)
                .map(|index| unsafe { CFArrayGetValueAtIndex(value.cast(), index as CFIndex) })
                .collect::<Vec<_>>();
            let inspected = inspect_bounded_child_entries(&entries, limit, |child| {
                !child.is_null()
                    && unsafe { CFGetTypeID((*child).cast()) } == unsafe { AXUIElementGetTypeID() }
            });
            let inspected_count = inspected.unwrap_or_else(|inspected| inspected);
            self.descendants_inspected += inspected_count;
            if inspected.is_err() {
                self.invalid_metadata = true;
                unsafe { CFRelease(value.cast()) };
                return Vec::new();
            }
            let mut result = Vec::with_capacity(count);
            for child in entries {
                unsafe { CFRetain(child.cast()) };
                result.push(NativeAxElement(child.cast()));
            }
            unsafe { CFRelease(value.cast()) };
            result
        }

        fn frame(&mut self, element: &Self::Element) -> Option<AxFrame> {
            let point_value = self.ax_value(element, "AXPosition", AX_VALUE_CGPOINT)?;
            let mut point = CGPoint::new(0.0, 0.0);
            let copied_point = unsafe {
                AXValueGetValue(
                    point_value.cast(),
                    AX_VALUE_CGPOINT,
                    (&mut point as *mut CGPoint).cast(),
                )
            };
            unsafe { CFRelease(point_value.cast()) };
            if !copied_point {
                return None;
            }
            let size_value = self.ax_value(element, "AXSize", AX_VALUE_CGSIZE)?;
            let mut size = CGSize::new(0.0, 0.0);
            let copied_size = unsafe {
                AXValueGetValue(
                    size_value.cast(),
                    AX_VALUE_CGSIZE,
                    (&mut size as *mut CGSize).cast(),
                )
            };
            unsafe { CFRelease(size_value.cast()) };
            copied_size.then_some(AxFrame {
                x: point.x,
                y: point.y,
                width: size.width,
                height: size.height,
            })
        }

        fn value_settable(&mut self, element: &Self::Element) -> bool {
            let attribute = CFString::from_static_string("AXValue");
            let mut settable = false;
            (unsafe {
                AXUIElementIsAttributeSettable(
                    element.0,
                    attribute.as_concrete_TypeRef(),
                    &mut settable,
                ) == AX_ERROR_SUCCESS
            }) && settable
        }

        fn caret_frame(&mut self, element: &Self::Element) -> Option<AxFrame> {
            let range = self.ax_value(element, "AXSelectedTextRange", AX_VALUE_CFRANGE)?;
            let mut selected = CFRange {
                location: 0,
                length: 0,
            };
            let copied = unsafe {
                AXValueGetValue(
                    range.cast(),
                    AX_VALUE_CFRANGE,
                    (&mut selected as *mut CFRange).cast(),
                )
            };
            if !copied || selected.location < 0 || selected.length < 0 {
                unsafe { CFRelease(range.cast()) };
                return None;
            }
            let attribute = CFString::from_static_string("AXBoundsForRange");
            let mut bounds = ptr::null();
            let status = unsafe {
                AXUIElementCopyParameterizedAttributeValue(
                    element.0,
                    attribute.as_concrete_TypeRef(),
                    range,
                    &mut bounds,
                )
            };
            unsafe { CFRelease(range.cast()) };
            if status != AX_ERROR_SUCCESS || bounds.is_null() {
                return None;
            }
            let bounds = unsafe {
                validate_ax_value_with(
                    bounds,
                    AXValueGetTypeID(),
                    AX_VALUE_CGRECT,
                    |value| CFGetTypeID(value.cast()),
                    |value| AXValueGetType(value.cast()),
                    |value| CFRelease(value.cast()),
                )?
            };
            let mut rect = CGRect::new(&CGPoint::new(0.0, 0.0), &CGSize::new(0.0, 0.0));
            let copied = unsafe {
                AXValueGetValue(
                    bounds.cast(),
                    AX_VALUE_CGRECT,
                    (&mut rect as *mut CGRect).cast(),
                )
            };
            unsafe { CFRelease(bounds.cast()) };
            copied.then_some(AxFrame {
                x: rect.origin.x,
                y: rect.origin.y,
                width: rect.size.width,
                height: rect.size.height,
            })
        }

        fn logical_identity(&self, element: &Self::Element) -> OpaqueAxIdentity {
            OpaqueAxIdentity::Native(Arc::new(NativeAxLogicalIdentity::retain_borrowed(
                element.0,
            )))
        }

        fn now(&self) -> Instant {
            Instant::now()
        }

        fn metadata_valid(&self) -> bool {
            !self.invalid_metadata
        }
    }

    fn bounded_native_string(value: CFStringRef) -> Option<String> {
        let length = unsafe { CFStringGetLength(value) };
        if length < 0 || length > MAX_UTF16_UNITS {
            unsafe { CFRelease(value.cast()) };
            return None;
        }
        let mut buffer = [0_u8; MAX_UTF8_BYTES];
        let mut bytes_used = 0;
        let converted = unsafe {
            CFStringGetBytes(
                value,
                CFRange {
                    location: 0,
                    length,
                },
                kCFStringEncodingUTF8,
                0,
                false as u8,
                buffer.as_mut_ptr(),
                buffer.len() as CFIndex,
                &mut bytes_used,
            )
        };
        unsafe { CFRelease(value.cast()) };
        if converted != length || bytes_used < 0 {
            return None;
        }
        let string = String::from_utf8(buffer[..bytes_used as usize].to_vec()).ok()?;
        (string.chars().take(MAX_SEMANTIC_SCALARS + 1).count() <= MAX_SEMANTIC_SCALARS)
            .then_some(string)
    }

    fn active_screen_frames() -> Vec<ScreenFrame> {
        CGDisplay::active_displays()
            .unwrap_or_default()
            .into_iter()
            .map(CGDisplay::new)
            .map(|display| display.bounds())
            .map(|bounds| ScreenFrame {
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.size.width,
                height: bounds.size.height,
            })
            .collect()
    }

    pub fn capture_native_fill_context(
        target: &FrontmostApp,
        observer_generation: u64,
    ) -> Result<CapturedAxContext, AxContextError> {
        if !crate::frontmost::target_is_running(target) {
            return Err(AxContextError::Focus(
                FocusRejectReason::ApplicationTerminated,
            ));
        }
        let application = unsafe { AXUIElementCreateApplication(target.process_id) };
        if application.is_null() {
            return Err(AxContextError::Focus(FocusRejectReason::StaleElement));
        }
        let application = NativeAxElement(application);
        let mut port = NativeAxMetadataPort::new();
        let focused = port
            .element(&application, "AXFocusedUIElement")
            .ok_or(AxContextError::Focus(FocusRejectReason::StaleElement))?;
        capture_with_port(
            &mut port,
            focused,
            target.clone(),
            &active_screen_frames(),
            observer_generation,
        )
    }

    pub fn validate_native_fingerprints(
        target: &FrontmostApp,
        fields: &[CapturedFieldFingerprint],
        observer_generation: u64,
    ) -> Result<(), DetectedFillError> {
        let application = unsafe { AXUIElementCreateApplication(target.process_id) };
        if application.is_null() {
            return Err(DetectedFillError::TargetChanged);
        }
        validate_fingerprints_from_application(
            &mut NativeAxMetadataPort::new(),
            NativeAxElement(application),
            target.clone(),
            &active_screen_frames(),
            fields,
            observer_generation,
        )
    }

    fn reacquire_exact_element(
        plan: &CapturedFillPlan,
        stored_fields: &[CapturedFieldFingerprint],
        expected: &CapturedFieldFingerprint,
    ) -> Result<NativeAxElement, crate::autofill_detected_fill::ExactAxFillError> {
        use crate::autofill_detected_fill::ExactAxFillError;

        let generation = expected.observer_generation;
        if plan.observer_generation.current() != generation {
            return Err(ExactAxFillError::GenerationChanged);
        }
        if !crate::frontmost::target_is_running(&plan.target) {
            return Err(ExactAxFillError::TargetChanged);
        }
        let application = unsafe { AXUIElementCreateApplication(plan.target.process_id) };
        if application.is_null() {
            return Err(ExactAxFillError::TargetChanged);
        }
        let application = NativeAxElement(application);
        let mut port = NativeAxMetadataPort::new();
        let (captured, elements) = recapture_fingerprints_from_application(
            &mut port,
            application,
            plan.target.clone(),
            &active_screen_frames(),
            stored_fields,
            generation,
        )
        .map_err(|_| ExactAxFillError::FrameChanged)?;
        if plan.observer_generation.current() != generation {
            return Err(ExactAxFillError::GenerationChanged);
        }
        if !crate::frontmost::target_is_running(&plan.target) {
            return Err(ExactAxFillError::TargetChanged);
        }
        let index =
            exact_fill_element_index(stored_fields, &captured.fields, expected, generation)?;
        elements
            .into_iter()
            .nth(index)
            .ok_or(ExactAxFillError::FrameChanged)
    }

    pub(crate) fn set_value_exact(
        plan: &CapturedFillPlan,
        fingerprint: &CapturedFieldFingerprint,
        value: &str,
    ) -> Result<
        crate::autofill_detected_fill::ExactSetValueOutcome,
        crate::autofill_detected_fill::ExactAxFillError,
    > {
        use crate::autofill_detected_fill::{ExactAxFillError, ExactSetValueOutcome};

        let element = reacquire_exact_element(plan, &plan.fields, fingerprint)?;
        if plan.observer_generation.current() != fingerprint.observer_generation
            || !crate::frontmost::target_is_running(&plan.target)
        {
            return Err(ExactAxFillError::GenerationChanged);
        }
        let attribute = CFString::from_static_string("AXValue");
        let value = CFString::new(value);
        match unsafe {
            AXUIElementSetAttributeValue(
                element.0,
                attribute.as_concrete_TypeRef(),
                value.as_concrete_TypeRef().cast(),
            )
        } {
            AX_ERROR_SUCCESS => Ok(ExactSetValueOutcome::Written),
            AX_ERROR_ATTRIBUTE_UNSUPPORTED | AX_ERROR_NOT_IMPLEMENTED => {
                Ok(ExactSetValueOutcome::Unsupported)
            }
            _ => Err(ExactAxFillError::WriteFailed),
        }
    }

    fn command_v_events() -> Result<(CGEvent, CGEvent), ()> {
        let down_source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)?;
        let up_source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)?;
        let down = CGEvent::new_keyboard_event(down_source, 9, true)?;
        let up = CGEvent::new_keyboard_event(up_source, 9, false)?;
        down.set_flags(CGEventFlags::CGEventFlagCommand);
        up.set_flags(CGEventFlags::CGEventFlagCommand);
        Ok((down, up))
    }

    pub(crate) fn focus_and_paste_exact(
        plan: &CapturedFillPlan,
        fingerprint: &CapturedFieldFingerprint,
        value: &str,
        clipboard_generation: &crate::clipboard::ClipboardGeneration,
    ) -> Result<(), crate::autofill_detected_fill::ExactAxFillError> {
        use crate::autofill_detected_fill::ExactAxFillError;

        let mut matches = plan
            .fields
            .iter()
            .enumerate()
            .filter(|(_, field)| field.element_identity == fingerprint.element_identity);
        let Some((index, _)) = matches.next() else {
            return Err(ExactAxFillError::FrameChanged);
        };
        if matches.next().is_some() {
            return Err(ExactAxFillError::FrameChanged);
        }
        let mut focused_fields = plan.fields.clone();
        for field in &mut focused_fields {
            field.focused = false;
        }
        focused_fields[index].focused = true;
        let focused_fingerprint = focused_fields[index].clone();
        let (down, up) = command_v_events().map_err(|_| ExactAxFillError::PasteFailed)?;
        let _shared_clipboard_transaction = clipboard_generation
            .lock_operation()
            .map_err(|_| ExactAxFillError::PasteFailed)?;
        let mut clipboard = NativeSecureClipboard::new();
        guarded_paste_transaction(&mut clipboard, value, |deadline| {
            exact_paste_event_with(
                deadline,
                || {
                    let element =
                        reacquire_exact_element(plan, &plan.fields, fingerprint).map_err(|_| ())?;
                    let focused_attribute = CFString::from_static_string("AXFocused");
                    let focused_value = CFBoolean::true_value();
                    (unsafe {
                        AXUIElementSetAttributeValue(
                            element.0,
                            focused_attribute.as_concrete_TypeRef(),
                            focused_value.as_concrete_TypeRef().cast(),
                        )
                    } == AX_ERROR_SUCCESS)
                        .then_some(())
                        .ok_or(())
                },
                || {
                    if plan.observer_generation.current() != fingerprint.observer_generation
                        || !crate::frontmost::target_is_running(&plan.target)
                    {
                        return Err(());
                    }
                    // Reacquire the exact focused element twice; the second check is immediately
                    // adjacent to the event enqueue and rejects every observable focus seam.
                    reacquire_exact_element(plan, &focused_fields, &focused_fingerprint)
                        .map(|_| ())
                        .map_err(|_| ())
                },
                || {
                    down.post_to_pid(plan.target.process_id);
                    up.post_to_pid(plan.target.process_id);
                    Ok(())
                },
                Instant::now,
            )
        })
        .map_err(|_| ExactAxFillError::PasteFailed)
    }
}

#[cfg(target_os = "macos")]
pub use macos::capture_native_fill_context;

#[cfg(target_os = "macos")]
fn validate_native_fingerprints(
    target: &FrontmostApp,
    fields: &[CapturedFieldFingerprint],
    observer_generation: u64,
) -> Result<(), DetectedFillError> {
    macos::validate_native_fingerprints(target, fields, observer_generation)
}

#[cfg(target_os = "macos")]
pub(crate) use macos::{focus_and_paste_exact, set_value_exact};

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_value_exact(
    _plan: &CapturedFillPlan,
    _fingerprint: &CapturedFieldFingerprint,
    _value: &str,
) -> Result<
    crate::autofill_detected_fill::ExactSetValueOutcome,
    crate::autofill_detected_fill::ExactAxFillError,
> {
    Err(crate::autofill_detected_fill::ExactAxFillError::TargetChanged)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn focus_and_paste_exact(
    _plan: &CapturedFillPlan,
    _fingerprint: &CapturedFieldFingerprint,
    _value: &str,
    _clipboard_generation: &crate::clipboard::ClipboardGeneration,
) -> Result<(), crate::autofill_detected_fill::ExactAxFillError> {
    Err(crate::autofill_detected_fill::ExactAxFillError::TargetChanged)
}

#[cfg(not(target_os = "macos"))]
pub fn capture_native_fill_context(
    _target: &FrontmostApp,
    _observer_generation: u64,
) -> Result<CapturedAxContext, AxContextError> {
    Err(AxContextError::Focus(FocusRejectReason::PermissionDenied))
}

pub fn capture_with_port<P: AxMetadataPort>(
    port: &mut P,
    focused_element: P::Element,
    target: FrontmostApp,
    screens: &[ScreenFrame],
    observer_generation: u64,
) -> Result<CapturedAxContext, AxContextError> {
    capture_with_port_and_elements(port, focused_element, target, screens, observer_generation)
        .map(|(context, _)| context)
}

fn capture_with_port_and_elements<P: AxMetadataPort>(
    port: &mut P,
    focused_element: P::Element,
    target: FrontmostApp,
    screens: &[ScreenFrame],
    observer_generation: u64,
) -> Result<(CapturedAxContext, Vec<P::Element>), AxContextError> {
    let started = port.now();
    check_budget(port, started)?;
    let focused_strings = read_semantic_strings(port, &focused_element, started)?;
    ensure_metadata_valid(port)?;

    // Capture the focused field before walking the surrounding accessibility tree. Large
    // Electron/WebKit trees can exhaust the bounded form-discovery budget even though the
    // focused field itself is healthy. Form discovery is an enhancement; it must not erase a
    // confidently detected focused-field action.
    let window = port
        .element(&focused_element, "AXWindow")
        .ok_or(AxContextError::MissingWindow)?;
    let focused_frame = port
        .frame(&focused_element)
        .ok_or(AxContextError::Focus(FocusRejectReason::MissingFrame))?;
    let window_frame = port
        .frame(&window)
        .filter(valid_frame)
        .ok_or(AxContextError::MissingWindow)?;
    let editable = port.value_settable(&focused_element);
    let enabled = read_enabled(port, &focused_element, started)?.unwrap_or(editable);
    ensure_metadata_valid(port)?;
    if !editable || !enabled {
        return Err(AxContextError::NoWritableField);
    }
    let caret_frame = port.caret_frame(&focused_element).filter(valid_caret_frame);
    ensure_metadata_valid(port)?;
    check_budget(port, started)?;

    let focus_observation = FocusedFieldObservation {
        permission_granted: true,
        fallback_eligibility: FallbackEligibility::SystemUnsupported,
        app: AppIdentity {
            bundle_id: target.bundle_id.clone(),
            process_id: target.process_id,
            live: true,
        },
        role: focused_strings.role.clone(),
        subrole: focused_strings.subrole.clone(),
        editable,
        frame: Some(focused_frame),
        element_valid: true,
        window_valid: true,
        observed_at: started,
    };
    let focused = classify_focused_field(
        focus_observation,
        screens,
        crate::frontmost::APP_BUNDLE_ID,
        port.now(),
    )?;

    let mut observations = vec![semantic_observation(
        focused_strings,
        focused_frame,
        editable,
        enabled,
        true,
        vec![0],
    )];
    let mut observation_elements = vec![focused_element.clone()];
    let mut observation_paths = vec![vec![0]];
    let mut form_discovery_failed = false;

    let mut root = focused_element.clone();
    for _ in 0..MAX_ANCESTORS {
        if check_budget(port, started).is_err() {
            form_discovery_failed = true;
            break;
        }
        let Some(parent) = port.element(&root, "AXParent") else {
            if !port.metadata_valid() {
                form_discovery_failed = true;
            }
            break;
        };
        root = parent;
    }

    let mut queue = VecDeque::from([(root, vec![0_u16])]);
    let mut descendants = Vec::new();
    while !form_discovery_failed {
        let Some((element, path)) = queue.pop_front() else {
            break;
        };
        if check_budget(port, started).is_err() {
            form_discovery_failed = true;
            break;
        }
        let remaining = MAX_DESCENDANTS.saturating_sub(descendants.len());
        if remaining == 0 {
            form_discovery_failed = true;
            break;
        }
        let children = port.elements(&element, "AXChildren", remaining);
        if ensure_metadata_valid(port).is_err() {
            form_discovery_failed = true;
            break;
        }
        for (index, child) in children.into_iter().take(remaining).enumerate() {
            let mut child_path = path.clone();
            child_path.push(index.min(u16::MAX as usize) as u16);
            descendants.push((child.clone(), child_path.clone()));
            queue.push_back((child, child_path));
        }
    }
    let focused_traversal_path = descendants
        .iter()
        .find(|(element, _)| *element == focused_element)
        .map(|(_, path)| path.clone())
        .unwrap_or_else(|| vec![0]);
    if !form_discovery_failed {
        observations[0].container_path = container_path(&focused_traversal_path);
        observation_paths[0] = focused_traversal_path;
    }

    for (element, path) in descendants
        .into_iter()
        .take_while(|_| !form_discovery_failed)
    {
        if element == focused_element {
            continue;
        }
        if observations.len() >= MAX_FIELDS {
            form_discovery_failed = true;
            break;
        }
        if check_budget(port, started).is_err() {
            form_discovery_failed = true;
            break;
        }
        let strings = match read_semantic_strings(port, &element, started) {
            Ok(strings) => strings,
            Err(_) => {
                form_discovery_failed = true;
                break;
            }
        };
        if ensure_metadata_valid(port).is_err() {
            form_discovery_failed = true;
            break;
        }
        if !is_text_role(strings.role.as_deref(), strings.subrole.as_deref()) {
            continue;
        }
        let editable = port.value_settable(&element);
        let enabled = match read_enabled(port, &element, started) {
            Ok(enabled) => enabled.unwrap_or(editable),
            Err(_) => {
                form_discovery_failed = true;
                break;
            }
        };
        if ensure_metadata_valid(port).is_err() {
            form_discovery_failed = true;
            break;
        }
        if !editable || !enabled {
            continue;
        }
        let frame = port.frame(&element).filter(valid_frame);
        if ensure_metadata_valid(port).is_err() {
            form_discovery_failed = true;
            break;
        }
        let Some(frame) = frame else {
            continue;
        };
        observations.push(semantic_observation(
            strings,
            frame,
            editable,
            enabled,
            false,
            container_path(&path),
        ));
        observation_elements.push(element);
        observation_paths.push(path);
    }
    if form_discovery_failed {
        observations.truncate(1);
        observation_elements.truncate(1);
        observation_paths.truncate(1);
    }
    if observations.is_empty() {
        return Err(AxContextError::NoWritableField);
    }
    let detected = classify_fields(&observations);
    let action = if form_discovery_failed {
        detected
            .first()
            .filter(|field| {
                field.focused
                    && field.confidence != FieldConfidence::Low
                    && field.secret_field.is_some()
            })
            .map(|field| DetectedAction::Field {
                field: field.secret_field.expect("checked above"),
            })
            .unwrap_or(DetectedAction::Choose)
    } else {
        detect_action(&detected)
    };
    let window_identity = port.logical_identity(&window);
    let fields = observations
        .iter()
        .zip(detected.iter())
        .zip(observation_elements.iter())
        .zip(observation_paths)
        .map(|(((observation, detected), element), traversal_path)| {
            let _internal_score = detected.score;
            CapturedFieldFingerprint {
                process_id: target.process_id,
                role: observation.role.clone(),
                frame: observation.frame,
                window_frame,
                container_path: observation.container_path.clone(),
                traversal_path,
                window_identity: window_identity.clone(),
                element_identity: port.logical_identity(element),
                kind: detected.kind,
                secret_field: detected.secret_field,
                confidence: detected.confidence,
                focused: detected.focused,
                observer_generation,
            }
        })
        .collect();
    Ok((
        CapturedAxContext {
            focused,
            caret_frame,
            fields,
            action,
        },
        observation_elements,
    ))
}

#[derive(Default)]
struct SemanticStrings {
    role: Option<String>,
    subrole: Option<String>,
    role_description: Option<String>,
    title: Option<String>,
    description: Option<String>,
    help: Option<String>,
    placeholder: Option<String>,
    identifier: Option<String>,
    linked_title: Option<String>,
}

fn read_semantic_strings<P: AxMetadataPort>(
    port: &mut P,
    element: &P::Element,
    started: Instant,
) -> Result<SemanticStrings, AxContextError> {
    let role = bounded_string(port.string(element, "AXRole"))?;
    let subrole = bounded_string(port.string(element, "AXSubrole"))?;
    let role_description = bounded_string(port.string(element, "AXRoleDescription"))?;
    let title = bounded_string(port.string(element, "AXTitle"))?;
    let description = bounded_string(port.string(element, "AXDescription"))?;
    let help = bounded_string(port.string(element, "AXHelp"))?;
    let placeholder = bounded_string(port.string(element, "AXPlaceholderValue"))?;
    let identifier = bounded_string(port.string(element, "AXIdentifier"))?;
    let linked_title_element = port.element(element, "AXTitleUIElement");
    let linked_title = linked_title_element
        .as_ref()
        .map(|title_element| bounded_string(port.string(title_element, "AXTitle")))
        .transpose()?
        .flatten();
    check_budget(port, started)?;
    Ok(SemanticStrings {
        role,
        subrole,
        role_description,
        title,
        description,
        help,
        placeholder,
        identifier,
        linked_title,
    })
}

fn bounded_string(value: Option<String>) -> Result<Option<String>, AxContextError> {
    match value {
        Some(value)
            if value.chars().take(MAX_SEMANTIC_SCALARS + 1).count() > MAX_SEMANTIC_SCALARS =>
        {
            Err(AxContextError::OversizedMetadata)
        }
        Some(value) if value.is_empty() => Ok(None),
        value => Ok(value),
    }
}

fn read_enabled<P: AxMetadataPort>(
    port: &mut P,
    element: &P::Element,
    started: Instant,
) -> Result<Option<bool>, AxContextError> {
    let value = bounded_string(port.string(element, "AXEnabled"))?;
    check_budget(port, started)?;
    Ok(value.map(|value| value == "true"))
}

fn semantic_observation(
    strings: SemanticStrings,
    frame: AxFrame,
    editable: bool,
    enabled: bool,
    focused: bool,
    container_path: Vec<u16>,
) -> SemanticFieldObservation {
    SemanticFieldObservation {
        role: strings.role.unwrap_or_default(),
        subrole: strings.subrole,
        role_description: strings.role_description,
        title: strings.title,
        description: strings.description,
        help: strings.help,
        placeholder: strings.placeholder,
        identifier: strings.identifier,
        linked_title: strings.linked_title,
        frame,
        editable,
        enabled,
        focused,
        container_path,
    }
}

fn check_budget<P: AxMetadataPort>(port: &P, started: Instant) -> Result<(), AxContextError> {
    if port
        .now()
        .checked_duration_since(started)
        .is_none_or(|elapsed| elapsed > OBSERVATION_BUDGET)
    {
        Err(AxContextError::TimeBudgetExceeded)
    } else {
        Ok(())
    }
}

fn ensure_metadata_valid<P: AxMetadataPort>(port: &P) -> Result<(), AxContextError> {
    port.metadata_valid()
        .then_some(())
        .ok_or(AxContextError::OversizedMetadata)
}

fn container_path(path: &[u16]) -> Vec<u16> {
    if path.len() > 1 {
        path[..path.len() - 1].to_vec()
    } else {
        vec![0]
    }
}

fn is_text_role(role: Option<&str>, _subrole: Option<&str>) -> bool {
    matches!(role, Some(AX_TEXT_FIELD | AX_SECURE_TEXT_FIELD))
}

fn valid_frame(frame: &AxFrame) -> bool {
    [frame.x, frame.y, frame.width, frame.height]
        .into_iter()
        .all(f64::is_finite)
        && frame.width > 0.0
        && frame.height > 0.0
}

fn valid_caret_frame(frame: &AxFrame) -> bool {
    [frame.x, frame.y, frame.width, frame.height]
        .into_iter()
        .all(f64::is_finite)
        && frame.width >= 0.0
        && frame.height > 0.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accessibility_focus::{AxFrame, ScreenFrame};
    use crate::autofill_contract::AutoFillSecretField;
    use crate::autofill_field_context::{DetectedAction, DetectedFieldKind, FieldConfidence};
    use crate::frontmost::test_frontmost_app;
    use std::cell::Cell;
    use std::collections::{HashMap, HashSet};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    #[derive(Clone, Debug, Eq, PartialEq)]
    struct FakeClipboardState {
        items: Vec<Vec<(String, Vec<u8>)>>,
        generation: isize,
        clears: usize,
    }

    struct FakeSecureClipboard {
        state: Arc<Mutex<FakeClipboardState>>,
        fail_restore: bool,
        fail_write: Option<ClipboardWriteError>,
        external_on_untouched_failure: bool,
    }

    impl SecureClipboardPort for FakeSecureClipboard {
        fn snapshot_all(&mut self) -> Result<ClipboardSnapshot, ()> {
            let state = self.state.lock().unwrap();
            Ok(ClipboardSnapshot::from_plain_items(state.items.clone()))
        }

        fn write_secret(&mut self, value: &str) -> Result<isize, ClipboardWriteError> {
            let mut state = self.state.lock().unwrap();
            if let Some(error) = self.fail_write {
                if self.external_on_untouched_failure {
                    state.generation += 1;
                    state.items = vec![vec![("external".to_owned(), b"new".to_vec())]];
                }
                return Err(error);
            }
            state.generation += 1;
            state.items = vec![vec![
                (
                    "public.utf8-plain-text".to_owned(),
                    value.as_bytes().to_vec(),
                ),
                ("org.nspasteboard.TransientType".to_owned(), Vec::new()),
                ("org.nspasteboard.ConcealedType".to_owned(), Vec::new()),
            ]];
            Ok(state.generation)
        }

        fn restore_if_unchanged(
            &mut self,
            owned_generation: isize,
            snapshot: &ClipboardSnapshot,
        ) -> Result<ClipboardRestoreDisposition, ()> {
            let mut state = self.state.lock().unwrap();
            if state.generation != owned_generation {
                return Ok(ClipboardRestoreDisposition::ExternalMutationPreserved);
            }
            if self.fail_restore {
                return Err(());
            }
            state.generation += 1;
            state.items = snapshot.to_plain_items();
            Ok(ClipboardRestoreDisposition::Restored)
        }

        fn clear_if_unchanged(&mut self, owned_generation: isize) -> Result<bool, ()> {
            let mut state = self.state.lock().unwrap();
            if state.generation != owned_generation {
                return Ok(false);
            }
            state.generation += 1;
            state.items.clear();
            state.clears += 1;
            Ok(true)
        }
    }

    struct ScriptedPasteClockWait {
        now_values: std::collections::VecDeque<Instant>,
        wait_result: Result<(), ()>,
        during_wait: Option<Box<dyn FnMut(Duration)>>,
    }

    impl PasteClockWaitPort for ScriptedPasteClockWait {
        fn now(&mut self) -> Instant {
            self.now_values
                .pop_front()
                .expect("test must provide every observed time")
        }

        fn wait_for(&mut self, duration: Duration) -> Result<(), ()> {
            if let Some(during_wait) = &mut self.during_wait {
                during_wait(duration);
            }
            self.wait_result
        }
    }

    #[derive(Clone, Debug, Eq, Hash, PartialEq)]
    struct Element(u16);

    struct FakePort {
        started: Instant,
        elapsed: Duration,
        now_calls: Cell<usize>,
        strings: HashMap<(u16, &'static str), String>,
        elements: HashMap<(u16, &'static str), Element>,
        children: HashMap<u16, Vec<Element>>,
        frames: HashMap<u16, AxFrame>,
        settable: HashSet<u16>,
        caret: Option<AxFrame>,
        requested: Vec<&'static str>,
        parameterized: Vec<&'static str>,
        child_visits: usize,
        child_request_limits: Vec<usize>,
        parent_requests: usize,
        delay_elapsed_until_child_visits: Option<usize>,
        invalid_frame_metadata: HashSet<u16>,
        invalid_metadata: Cell<bool>,
    }

    impl FakePort {
        fn login_form() -> Self {
            let started = Instant::now();
            let field = |x| AxFrame {
                x,
                y: 100.0,
                width: 180.0,
                height: 24.0,
            };
            Self {
                started,
                elapsed: Duration::ZERO,
                now_calls: Cell::new(0),
                strings: HashMap::from([
                    ((1, "AXRole"), "AXTextField".into()),
                    ((1, "AXPlaceholderValue"), "Email".into()),
                    ((1, "AXEnabled"), "true".into()),
                    ((2, "AXRole"), "AXSecureTextField".into()),
                    ((2, "AXPlaceholderValue"), "Password".into()),
                    ((2, "AXEnabled"), "true".into()),
                ]),
                elements: HashMap::from([
                    ((1, "AXParent"), Element(10)),
                    ((10, "AXParent"), Element(11)),
                    ((11, "AXParent"), Element(12)),
                    ((1, "AXWindow"), Element(20)),
                ]),
                children: HashMap::from([
                    (12, vec![Element(11)]),
                    (11, vec![Element(10)]),
                    (10, vec![Element(1), Element(2)]),
                ]),
                frames: HashMap::from([
                    (1, field(100.0)),
                    (2, field(100.0)),
                    (
                        20,
                        AxFrame {
                            x: 20.0,
                            y: 20.0,
                            width: 800.0,
                            height: 600.0,
                        },
                    ),
                ]),
                settable: HashSet::from([1, 2]),
                caret: Some(AxFrame {
                    x: 116.0,
                    y: 102.0,
                    width: 1.0,
                    height: 20.0,
                }),
                requested: Vec::new(),
                parameterized: Vec::new(),
                child_visits: 0,
                child_request_limits: Vec::new(),
                parent_requests: 0,
                delay_elapsed_until_child_visits: None,
                invalid_frame_metadata: HashSet::new(),
                invalid_metadata: Cell::new(false),
            }
        }

        fn record(&mut self, attribute: &'static str) {
            if !self.requested.contains(&attribute) {
                self.requested.push(attribute);
            }
        }
    }

    impl AxMetadataPort for FakePort {
        type Element = Element;

        fn string(&mut self, element: &Self::Element, attribute: &'static str) -> Option<String> {
            self.record(attribute);
            self.strings.get(&(element.0, attribute)).cloned()
        }

        fn element(
            &mut self,
            element: &Self::Element,
            attribute: &'static str,
        ) -> Option<Self::Element> {
            self.record(attribute);
            if attribute == "AXParent" {
                self.parent_requests += 1;
            }
            self.elements.get(&(element.0, attribute)).cloned()
        }

        fn elements(
            &mut self,
            element: &Self::Element,
            attribute: &'static str,
            limit: usize,
        ) -> Vec<Self::Element> {
            self.record(attribute);
            self.child_request_limits.push(limit);
            let result = self
                .children
                .get(&element.0)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .take(limit)
                .collect::<Vec<_>>();
            self.child_visits += result.len();
            result
        }

        fn frame(&mut self, element: &Self::Element) -> Option<AxFrame> {
            self.record("AXPosition");
            self.record("AXSize");
            if self.invalid_frame_metadata.contains(&element.0) {
                self.invalid_metadata.set(true);
                return None;
            }
            self.frames.get(&element.0).copied()
        }

        fn value_settable(&mut self, element: &Self::Element) -> bool {
            self.settable.contains(&element.0)
        }

        fn caret_frame(&mut self, _element: &Self::Element) -> Option<AxFrame> {
            self.record("AXSelectedTextRange");
            self.parameterized.push("AXBoundsForRange");
            self.caret
        }

        fn logical_identity(&self, element: &Self::Element) -> OpaqueAxIdentity {
            OpaqueAxIdentity::for_test(u64::from(element.0))
        }

        fn now(&self) -> Instant {
            let call = self.now_calls.get();
            self.now_calls.set(call + 1);
            self.started
                + if call == 0
                    || self
                        .delay_elapsed_until_child_visits
                        .is_some_and(|visits| self.child_visits < visits)
                {
                    Duration::ZERO
                } else {
                    self.elapsed
                }
        }

        fn metadata_valid(&self) -> bool {
            !self.invalid_metadata.get()
        }
    }

    fn screen() -> ScreenFrame {
        ScreenFrame {
            x: 0.0,
            y: 0.0,
            width: 1440.0,
            height: 900.0,
        }
    }

    fn fingerprint(field: AutoFillSecretField, focused: bool) -> CapturedFieldFingerprint {
        CapturedFieldFingerprint {
            process_id: 42,
            role: if field == AutoFillSecretField::Password {
                "AXSecureTextField"
            } else {
                "AXTextField"
            }
            .into(),
            frame: AxFrame {
                x: 100.0,
                y: 100.0,
                width: 180.0,
                height: 24.0,
            },
            window_frame: AxFrame {
                x: 20.0,
                y: 20.0,
                width: 800.0,
                height: 600.0,
            },
            container_path: vec![1],
            traversal_path: vec![1, field as u8 as u16 + 1],
            window_identity: OpaqueAxIdentity::for_test(1),
            element_identity: OpaqueAxIdentity::for_test(10 + field as u8 as u64),
            kind: if field == AutoFillSecretField::Password {
                DetectedFieldKind::Password
            } else {
                DetectedFieldKind::Email
            },
            secret_field: Some(field),
            confidence: FieldConfidence::High,
            focused,
            observer_generation: 7,
        }
    }

    #[test]
    fn reader_uses_only_the_bounded_privacy_allowlist_and_prefers_caret() {
        let mut port = FakePort::login_form();
        port.caret = Some(AxFrame {
            x: 116.0,
            y: 102.0,
            width: 0.0,
            height: 20.0,
        });
        let capture = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        )
        .expect("safe form");

        assert_eq!(
            port.requested,
            vec![
                "AXRole",
                "AXSubrole",
                "AXRoleDescription",
                "AXTitle",
                "AXDescription",
                "AXHelp",
                "AXPlaceholderValue",
                "AXIdentifier",
                "AXTitleUIElement",
                "AXWindow",
                "AXPosition",
                "AXSize",
                "AXEnabled",
                "AXSelectedTextRange",
                "AXParent",
                "AXChildren",
            ]
        );
        assert!(!port.requested.contains(&"AXValue"));
        assert!(port.parameterized.contains(&"AXBoundsForRange"));
        assert_eq!(capture.anchor_frame(), port.caret.unwrap());
        assert!(!valid_frame(&port.caret.unwrap()));
        assert_eq!(capture.fields.len(), 2);
        assert_eq!(
            capture.action,
            DetectedAction::Form {
                fields: vec![AutoFillSecretField::Username, AutoFillSecretField::Password]
            }
        );
    }

    #[test]
    fn reader_accepts_an_editable_electron_field_when_optional_enabled_is_absent() {
        let mut port = FakePort::login_form();
        port.strings.remove(&(1, "AXEnabled"));

        let capture = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.electron", 42, 9),
            &[screen()],
            7,
        )
        .expect("settable remains authoritative when optional AXEnabled is absent");

        assert_eq!(
            capture.fields[0].secret_field,
            Some(AutoFillSecretField::Username)
        );
        assert!(capture.fields[0].focused);
    }

    #[test]
    fn reader_still_rejects_an_explicitly_disabled_editable_field() {
        let mut port = FakePort::login_form();
        port.strings.insert((1, "AXEnabled"), "false".into());

        assert!(matches!(
            capture_with_port(
                &mut port,
                Element(1),
                test_frontmost_app("com.example.electron", 42, 9),
                &[screen()],
                7,
            ),
            Err(AxContextError::NoWritableField),
        ));
    }

    #[test]
    fn live_validation_recovers_the_exact_stored_field_after_the_popup_moves_focus() {
        let target = test_frontmost_app("com.example.editor", 42, 9);
        let mut original_port = FakePort::login_form();
        let stored = capture_with_port(
            &mut original_port,
            Element(1),
            target.clone(),
            &[screen()],
            7,
        )
        .expect("initial focused field")
        .fields;

        let mut live_port = FakePort::login_form();
        live_port.strings.insert((99, "AXRole"), "AXWebArea".into());
        live_port.strings.insert((99, "AXEnabled"), "true".into());
        live_port.elements.insert((99, "AXWindow"), Element(20));
        live_port.frames.insert(
            99,
            AxFrame {
                x: 20.0,
                y: 20.0,
                width: 800.0,
                height: 600.0,
            },
        );
        assert_eq!(
            capture_with_port(&mut live_port, Element(99), target.clone(), &[screen()], 8,)
                .unwrap_err(),
            AxContextError::NoWritableField,
        );

        live_port.children.insert(90, vec![Element(20)]);
        live_port.children.insert(20, vec![Element(12)]);
        assert_eq!(
            validate_fingerprints_from_application(
                &mut live_port,
                Element(90),
                target,
                &[screen()],
                &stored,
                8,
            ),
            Ok(()),
        );
    }

    #[test]
    fn reader_rejects_malformed_carets_without_relaxing_field_geometry() {
        for caret in [
            AxFrame {
                x: 116.0,
                y: 102.0,
                width: -1.0,
                height: 20.0,
            },
            AxFrame {
                x: f64::NAN,
                y: 102.0,
                width: 0.0,
                height: 20.0,
            },
            AxFrame {
                x: 116.0,
                y: 102.0,
                width: 0.0,
                height: 0.0,
            },
        ] {
            assert!(!valid_caret_frame(&caret));
        }
        assert!(!valid_frame(&AxFrame {
            x: 100.0,
            y: 100.0,
            width: 0.0,
            height: 24.0,
        }));
    }

    #[test]
    fn reader_falls_back_to_field_and_enforces_all_traversal_bounds() {
        let mut port = FakePort::login_form();
        port.caret = None;
        port.children.insert(12, (30..400).map(Element).collect());
        for id in 30..400 {
            port.strings.insert((id, "AXRole"), "AXTextField".into());
            port.strings
                .insert((id, "AXPlaceholderValue"), "Email".into());
            port.strings.insert((id, "AXEnabled"), "true".into());
            port.frames.insert(
                id,
                AxFrame {
                    x: 100.0,
                    y: f64::from(id),
                    width: 180.0,
                    height: 24.0,
                },
            );
            port.settable.insert(id);
        }
        let capture = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        )
        .expect("bounded capture");

        assert_eq!(capture.anchor_frame(), capture.focused.frame);
        assert!(port.child_visits <= 256);
        assert!(capture.fields.len() <= 20);
        assert_eq!(port.parent_requests, 3);
    }

    #[test]
    fn reader_rejects_oversized_metadata_and_work_past_fifty_milliseconds() {
        let mut bounded = FakePort::login_form();
        bounded.strings.insert((1, "AXTitle"), "界".repeat(255));
        assert!(capture_with_port(
            &mut bounded,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        )
        .is_ok());

        let mut oversized = FakePort::login_form();
        oversized.strings.insert((1, "AXTitle"), "界".repeat(256));
        assert_eq!(
            capture_with_port(
                &mut oversized,
                Element(1),
                test_frontmost_app("com.example.editor", 42, 9),
                &[screen()],
                7
            )
            .unwrap_err(),
            AxContextError::OversizedMetadata
        );

        let mut slow = FakePort::login_form();
        slow.elapsed = Duration::from_millis(51);
        assert_eq!(
            capture_with_port(
                &mut slow,
                Element(1),
                test_frontmost_app("com.example.editor", 42, 9),
                &[screen()],
                7
            )
            .unwrap_err(),
            AxContextError::TimeBudgetExceeded
        );

        let mut boundary = FakePort::login_form();
        boundary.elapsed = Duration::from_millis(50);
        assert!(capture_with_port(
            &mut boundary,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        )
        .is_ok());
    }

    #[test]
    fn reader_preserves_the_focused_field_when_a_large_electron_tree_exhausts_form_scan_budget() {
        let mut port = FakePort::login_form();
        port.elapsed = Duration::from_millis(51);
        port.delay_elapsed_until_child_visits = Some(1);

        let capture = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.electron", 42, 9),
            &[screen()],
            7,
        )
        .expect("focused field must survive a best-effort form scan timeout");

        assert_eq!(capture.fields.len(), 1);
        assert_eq!(
            capture.fields[0].secret_field,
            Some(AutoFillSecretField::Username)
        );
        assert!(matches!(
            capture.action,
            DetectedAction::Field {
                field: AutoFillSecretField::Username
            }
        ));
    }

    #[test]
    fn reader_preserves_the_focused_field_when_electron_form_metadata_is_malformed() {
        let mut port = FakePort::login_form();
        port.strings.insert((2, "AXTitle"), "界".repeat(256));

        let capture = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.electron", 42, 9),
            &[screen()],
            7,
        )
        .expect("malformed sibling metadata must not erase the healthy focused field");

        assert_eq!(capture.fields.len(), 1);
        assert_eq!(
            capture.fields[0].secret_field,
            Some(AutoFillSecretField::Username)
        );
        assert!(matches!(
            capture.action,
            DetectedAction::Field {
                field: AutoFillSecretField::Username
            }
        ));
    }

    #[test]
    fn reader_discards_a_partial_form_when_the_last_descendant_frame_has_the_wrong_type() {
        let mut port = FakePort::login_form();
        port.children
            .get_mut(&10)
            .expect("form children")
            .push(Element(3));
        port.strings.insert((3, "AXRole"), "AXTextField".into());
        port.strings
            .insert((3, "AXPlaceholderValue"), "Account".into());
        port.strings.insert((3, "AXEnabled"), "true".into());
        port.settable.insert(3);
        port.invalid_frame_metadata.insert(3);

        let capture = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.electron", 42, 9),
            &[screen()],
            7,
        )
        .expect("bad sibling geometry must fall back to the focused field");

        assert_eq!(capture.fields.len(), 1);
        assert_eq!(
            capture.action,
            DetectedAction::Field {
                field: AutoFillSecretField::Username
            }
        );
    }

    #[test]
    fn reader_discards_a_partial_form_when_descendant_or_field_limits_are_reached() {
        let mut field_limited = FakePort::login_form();
        let mut extra_fields = Vec::new();
        for id in 3..=(MAX_FIELDS as u16 + 2) {
            extra_fields.push(Element(id));
            field_limited
                .strings
                .insert((id, "AXRole"), "AXTextField".into());
            field_limited
                .strings
                .insert((id, "AXPlaceholderValue"), format!("Field {id}"));
            field_limited
                .strings
                .insert((id, "AXEnabled"), "true".into());
            field_limited.frames.insert(
                id,
                AxFrame {
                    x: 100.0,
                    y: f64::from(id) * 30.0,
                    width: 180.0,
                    height: 24.0,
                },
            );
            field_limited.settable.insert(id);
        }
        field_limited
            .children
            .get_mut(&10)
            .expect("form children")
            .extend(extra_fields);
        let field_capture = capture_with_port(
            &mut field_limited,
            Element(1),
            test_frontmost_app("com.example.electron", 42, 9),
            &[screen()],
            7,
        )
        .expect("field saturation falls back");
        assert_eq!(field_capture.fields.len(), 1);

        let mut descendant_limited = FakePort::login_form();
        descendant_limited
            .children
            .insert(12, (30..30 + MAX_DESCENDANTS as u16).map(Element).collect());
        let descendant_capture = capture_with_port(
            &mut descendant_limited,
            Element(1),
            test_frontmost_app("com.example.electron", 42, 9),
            &[screen()],
            7,
        )
        .expect("descendant saturation falls back");
        assert_eq!(descendant_capture.fields.len(), 1);
    }

    #[test]
    fn reader_uses_field_mode_for_a_single_secure_focus_after_form_discovery_fails() {
        let mut port = FakePort::login_form();
        port.strings
            .insert((1, "AXRole"), "AXSecureTextField".into());
        port.strings
            .insert((1, "AXPlaceholderValue"), "Password".into());
        port.strings.insert((2, "AXTitle"), "界".repeat(256));

        let capture = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.electron", 42, 9),
            &[screen()],
            7,
        )
        .expect("secure focused field survives form discovery failure");

        assert_eq!(
            capture.action,
            DetectedAction::Field {
                field: AutoFillSecretField::Password
            }
        );
    }

    #[test]
    fn reader_rejects_a_disabled_focus_and_invalid_window_geometry() {
        let mut disabled = FakePort::login_form();
        disabled.strings.insert((1, "AXEnabled"), "false".into());
        assert_eq!(
            capture_with_port(
                &mut disabled,
                Element(1),
                test_frontmost_app("com.example.editor", 42, 9),
                &[screen()],
                7,
            )
            .unwrap_err(),
            AxContextError::NoWritableField,
        );

        let mut invalid_window = FakePort::login_form();
        invalid_window.frames.insert(
            20,
            AxFrame {
                x: 20.0,
                y: 20.0,
                width: f64::NAN,
                height: 600.0,
            },
        );
        assert_eq!(
            capture_with_port(
                &mut invalid_window,
                Element(1),
                test_frontmost_app("com.example.editor", 42, 9),
                &[screen()],
                7,
            )
            .unwrap_err(),
            AxContextError::MissingWindow,
        );
    }

    #[test]
    fn tokens_expire_at_thirty_seconds_and_are_consumed_on_every_take_attempt() {
        let now = Arc::new(Mutex::new(Instant::now()));
        let store = DetectedFillContextStore::for_test(
            {
                let now = Arc::clone(&now);
                move || *now.lock().unwrap()
            },
            |_, _| Ok(()),
        );
        let presentation = store.insert(
            test_frontmost_app("com.example.editor", 42, 9),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );
        assert!(uuid::Uuid::parse_str(&presentation.fill_context_token).is_ok());
        *now.lock().unwrap() += Duration::from_secs(30);
        assert_eq!(
            store
                .take(
                    &presentation.fill_context_token,
                    &[AutoFillSecretField::Password]
                )
                .unwrap_err(),
            DetectedFillError::Expired
        );
        assert_eq!(
            store
                .take(
                    &presentation.fill_context_token,
                    &[AutoFillSecretField::Password]
                )
                .unwrap_err(),
            DetectedFillError::InvalidToken
        );

        let wrong = store.insert(
            test_frontmost_app("com.example.editor", 42, 9),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );
        assert_eq!(
            store
                .take(&wrong.fill_context_token, &[AutoFillSecretField::Username])
                .unwrap_err(),
            DetectedFillError::WrongFieldSubset
        );
        assert_eq!(
            store
                .take(&wrong.fill_context_token, &[AutoFillSecretField::Password])
                .unwrap_err(),
            DetectedFillError::InvalidToken
        );
    }

    #[test]
    fn capacity_rejects_without_evicting_and_invalidation_burns_every_context() {
        let store = DetectedFillContextStore::for_test(Instant::now, |_, _| Ok(()));
        let first = store.insert(
            test_frontmost_app("com.example.editor", 42, 1),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );
        for instance in 2..=64 {
            assert!(!store
                .insert(
                    test_frontmost_app("com.example.editor", 42, instance),
                    vec![fingerprint(AutoFillSecretField::Password, true)],
                    DetectedAction::Field {
                        field: AutoFillSecretField::Password
                    }
                )
                .fill_context_token
                .is_empty());
        }
        assert_eq!(
            store
                .try_insert(
                    test_frontmost_app("com.example.editor", 42, 65),
                    vec![fingerprint(AutoFillSecretField::Password, true)],
                    DetectedAction::Field {
                        field: AutoFillSecretField::Password
                    }
                )
                .unwrap_err(),
            DetectedFillError::CapacityReached
        );
        assert!(store
            .take(&first.fill_context_token, &[AutoFillSecretField::Password])
            .is_ok());

        let remaining = store.insert(
            test_frontmost_app("com.example.editor", 42, 66),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );
        store.invalidate_all();
        assert_eq!(
            store
                .take(
                    &remaining.fill_context_token,
                    &[AutoFillSecretField::Password]
                )
                .unwrap_err(),
            DetectedFillError::InvalidToken
        );
    }

    #[test]
    fn expired_capacity_is_purged_before_a_new_context_is_inserted() {
        let now = Arc::new(Mutex::new(Instant::now()));
        let store = DetectedFillContextStore::for_test(
            {
                let now = Arc::clone(&now);
                move || *now.lock().unwrap()
            },
            |_, _| Ok(()),
        );
        for instance in 1..=64 {
            store
                .try_insert(
                    test_frontmost_app("com.example.editor", 42, instance),
                    vec![fingerprint(AutoFillSecretField::Password, true)],
                    DetectedAction::Field {
                        field: AutoFillSecretField::Password,
                    },
                )
                .unwrap();
        }
        *now.lock().unwrap() += Duration::from_secs(30);
        assert!(store
            .try_insert(
                test_frontmost_app("com.example.editor", 42, 65),
                vec![fingerprint(AutoFillSecretField::Password, true)],
                DetectedAction::Field {
                    field: AutoFillSecretField::Password,
                },
            )
            .is_ok());
    }

    #[test]
    fn ambiguous_but_valid_focused_field_preserves_a_choose_context() {
        let mut port = FakePort::login_form();
        port.strings
            .insert((1, "AXPlaceholderValue"), "Account".into());
        port.children.insert(10, vec![Element(1)]);
        let capture = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        )
        .expect("editable focused fallback");
        assert_eq!(capture.action, DetectedAction::Choose);

        let store = DetectedFillContextStore::for_test(Instant::now, |_, _| Ok(()));
        let presentation = store.insert(
            test_frontmost_app("com.example.editor", 42, 9),
            capture.fields,
            capture.action,
        );
        assert_eq!(presentation.action.mode, PresentedActionMode::Choose);
        assert!(presentation.action.fields.is_empty());
        assert!(uuid::Uuid::parse_str(&presentation.fill_context_token).is_ok());
    }

    #[test]
    fn stale_app_pid_window_and_field_fingerprints_fail_closed() {
        for error in [
            DetectedFillError::TargetChanged,
            DetectedFillError::StaleProcess,
            DetectedFillError::StaleWindow,
            DetectedFillError::StaleField,
        ] {
            let store = DetectedFillContextStore::for_test(Instant::now, move |_, _| Err(error));
            let presentation = store.insert(
                test_frontmost_app("com.example.editor", 42, 9),
                vec![fingerprint(AutoFillSecretField::Password, true)],
                DetectedAction::Field {
                    field: AutoFillSecretField::Password,
                },
            );
            assert_eq!(
                store
                    .take(
                        &presentation.fill_context_token,
                        &[AutoFillSecretField::Password]
                    )
                    .unwrap_err(),
                error
            );
            assert_eq!(
                store
                    .take(
                        &presentation.fill_context_token,
                        &[AutoFillSecretField::Password]
                    )
                    .unwrap_err(),
                DetectedFillError::InvalidToken
            );
        }
    }

    #[test]
    fn insertion_rejects_cross_process_and_mixed_generation_fingerprints() {
        let store = DetectedFillContextStore::for_test(Instant::now, |_, _| Ok(()));
        let mut wrong_process = fingerprint(AutoFillSecretField::Password, true);
        wrong_process.process_id = 41;
        assert_eq!(
            store
                .try_insert(
                    test_frontmost_app("com.example.editor", 42, 9),
                    vec![wrong_process],
                    DetectedAction::Field {
                        field: AutoFillSecretField::Password,
                    },
                )
                .unwrap_err(),
            DetectedFillError::StaleProcess,
        );

        let username = fingerprint(AutoFillSecretField::Username, true);
        let mut password = fingerprint(AutoFillSecretField::Password, false);
        password.observer_generation = 8;
        assert_eq!(
            store
                .try_insert(
                    test_frontmost_app("com.example.editor", 42, 9),
                    vec![username, password],
                    DetectedAction::Form {
                        fields: vec![AutoFillSecretField::Username, AutoFillSecretField::Password,],
                    },
                )
                .unwrap_err(),
            DetectedFillError::StaleField,
        );
    }

    #[test]
    fn live_validation_rebinds_only_an_exact_field_multiset_to_the_current_generation() {
        let username = fingerprint(AutoFillSecretField::Username, true);
        let password = fingerprint(AutoFillSecretField::Password, false);
        let stored = vec![username.clone(), password.clone()];

        let mut reordered = vec![password.clone(), username.clone()];
        assert_eq!(
            validate_current_fingerprints(&stored, &reordered, 7),
            Ok(())
        );

        reordered[0].focused = true;
        reordered[1].focused = false;
        assert_eq!(
            validate_current_fingerprints(&stored, &reordered, 7),
            Err(DetectedFillError::StaleField)
        );

        let mut extra_confirm = stored.clone();
        extra_confirm.push(password.clone());
        assert_eq!(
            validate_current_fingerprints(&stored, &extra_confirm, 7),
            Err(DetectedFillError::StaleField)
        );
        assert_eq!(
            validate_current_fingerprints(&stored, &stored[..1], 7),
            Err(DetectedFillError::StaleField)
        );

        let mut changed_kind = stored.clone();
        changed_kind[1].kind = DetectedFieldKind::Unknown;
        assert_eq!(
            validate_current_fingerprints(&stored, &changed_kind, 7),
            Err(DetectedFillError::StaleField)
        );
        let mut changed_confidence = stored.clone();
        changed_confidence[1].confidence = FieldConfidence::Medium;
        assert_eq!(
            validate_current_fingerprints(&stored, &changed_confidence, 7),
            Err(DetectedFillError::StaleField)
        );
        let mut changed_secret_mapping = stored.clone();
        changed_secret_mapping[1].secret_field = Some(AutoFillSecretField::Username);
        assert_eq!(
            validate_current_fingerprints(&stored, &changed_secret_mapping, 7),
            Err(DetectedFillError::StaleField)
        );
        let mut recaptured = stored.clone();
        for field in &mut recaptured {
            field.observer_generation = 8;
        }
        assert_eq!(
            validate_current_fingerprints(&stored, &recaptured, 8),
            Ok(())
        );

        let mut stale_recapture = stored.clone();
        stale_recapture[1].observer_generation = 8;
        assert_eq!(
            validate_current_fingerprints(&stored, &stale_recapture, 8),
            Err(DetectedFillError::StaleGeneration)
        );
    }

    #[test]
    fn observer_generation_change_rebinds_the_token_after_exact_live_validation() {
        let generation = ObserverGeneration::new(7);
        let validator_calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let store =
            DetectedFillContextStore::for_test_with_generation(generation.clone(), Instant::now, {
                let validator_calls = Arc::clone(&validator_calls);
                move |_, _, _| {
                    validator_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(())
                }
            });
        let presentation = store.insert(
            test_frontmost_app("com.example.editor", 42, 9),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );

        generation.set(8);
        let plan = store
            .take(
                &presentation.fill_context_token,
                &[AutoFillSecretField::Password],
            )
            .expect("exact target is rebound after the popup activates");
        assert_eq!(validator_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(plan
            .fields
            .iter()
            .all(|field| field.observer_generation == 8));
        assert_eq!(
            plan.fingerprint_for_field(AutoFillSecretField::Password)
                .map(|field| field.observer_generation),
            Some(8),
        );
        assert_eq!(
            store
                .take(
                    &presentation.fill_context_token,
                    &[AutoFillSecretField::Password]
                )
                .unwrap_err(),
            DetectedFillError::InvalidToken
        );
    }

    #[test]
    fn explicit_take_binds_one_selected_value_to_the_unique_focused_field_and_burns_replay() {
        let store = DetectedFillContextStore::for_test(Instant::now, |_, _| Ok(()));
        let presentation = store.insert(
            test_frontmost_app("com.example.editor", 42, 9),
            vec![fingerprint(AutoFillSecretField::Username, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Username,
            },
        );

        let plan = store
            .take_explicit(
                &presentation.fill_context_token,
                AutoFillSecretField::Password,
            )
            .expect("explicit selection binds only to the focused field");
        assert_eq!(plan.requested, vec![AutoFillSecretField::Password]);
        assert!(plan
            .fingerprint_for_field(AutoFillSecretField::Password)
            .is_some());
        assert!(matches!(
            store.take_explicit(
                &presentation.fill_context_token,
                AutoFillSecretField::Password
            ),
            Err(DetectedFillError::InvalidToken),
        ));
    }

    #[test]
    fn live_fill_allows_only_the_exact_target_or_barwarden_popup_to_be_frontmost() {
        let target = test_frontmost_app("com.example.editor", 42, 9);
        let barwarden = test_frontmost_app(crate::frontmost::APP_BUNDLE_ID, 77, 10);
        let other = test_frontmost_app("com.example.other", 88, 11);

        assert!(frontmost_allows_live_fill(Some(&target), &target));
        assert!(frontmost_allows_live_fill(Some(&barwarden), &target));
        assert!(!frontmost_allows_live_fill(Some(&other), &target));
        assert!(!frontmost_allows_live_fill(None, &target));
    }

    #[test]
    fn observer_generation_change_during_live_validation_rejects_the_taken_token() {
        let generation = ObserverGeneration::new(7);
        let store =
            DetectedFillContextStore::for_test_with_generation(generation.clone(), Instant::now, {
                let generation = generation.clone();
                move |_, _, observed_generation| {
                    assert_eq!(observed_generation, 7);
                    generation.set(8);
                    Ok(())
                }
            });
        let presentation = store.insert(
            test_frontmost_app("com.example.editor", 42, 9),
            vec![fingerprint(AutoFillSecretField::Password, true)],
            DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        );

        assert_eq!(
            store
                .take(
                    &presentation.fill_context_token,
                    &[AutoFillSecretField::Password]
                )
                .unwrap_err(),
            DetectedFillError::StaleGeneration
        );
    }

    #[test]
    fn descendant_reader_requests_only_the_remaining_bounded_allowance() {
        let mut port = FakePort::login_form();
        port.children.insert(12, (30..400).map(Element).collect());
        let _ = capture_with_port(
            &mut port,
            Element(1),
            test_frontmost_app("com.example.editor", 42, 9),
            &[screen()],
            7,
        );

        assert!(!port.child_request_limits.is_empty());
        assert!(port
            .child_request_limits
            .iter()
            .all(|limit| *limit <= MAX_DESCENDANTS));
        assert_eq!(port.child_request_limits[0], MAX_DESCENDANTS);
    }

    #[test]
    fn invalid_bounded_child_entry_is_charged_and_fails_immediately() {
        let inspected = Cell::new(0);
        let result = inspect_bounded_child_entries(&[true, false, true], 3, |valid| {
            inspected.set(inspected.get() + 1);
            *valid
        });

        assert_eq!(result, Err(2));
        assert_eq!(inspected.get(), 2);
    }

    #[test]
    fn exact_fill_element_index_requires_the_same_process_window_frame_and_generation() {
        let username = fingerprint(AutoFillSecretField::Username, true);
        let password = fingerprint(AutoFillSecretField::Password, false);
        let stored = vec![username.clone(), password.clone()];
        let reordered = vec![password.clone(), username.clone()];

        assert_eq!(
            exact_fill_element_index(&stored, &reordered, &password, 7),
            Ok(0)
        );

        let cases = [
            {
                let mut changed = reordered.clone();
                changed[0].process_id = 99;
                (
                    changed,
                    crate::autofill_detected_fill::ExactAxFillError::ProcessChanged,
                )
            },
            {
                let mut changed = reordered.clone();
                changed[0].window_frame.x += 1.0;
                (
                    changed,
                    crate::autofill_detected_fill::ExactAxFillError::WindowChanged,
                )
            },
            {
                let mut changed = reordered.clone();
                changed[0].frame.x += 1.0;
                (
                    changed,
                    crate::autofill_detected_fill::ExactAxFillError::FrameChanged,
                )
            },
            {
                let mut changed = reordered.clone();
                changed[0].observer_generation = 8;
                (
                    changed,
                    crate::autofill_detected_fill::ExactAxFillError::GenerationChanged,
                )
            },
        ];
        for (current, expected_error) in cases {
            assert_eq!(
                exact_fill_element_index(&stored, &current, &password, 7),
                Err(expected_error)
            );
        }
    }

    #[test]
    fn exact_fill_rejects_duplicate_indistinguishable_element_fingerprints() {
        let password = fingerprint(AutoFillSecretField::Password, true);
        let stored = vec![password.clone(), password.clone()];
        let current = stored.clone();

        assert_eq!(
            exact_fill_element_index(&stored, &current, &password, 7),
            Err(crate::autofill_detected_fill::ExactAxFillError::FrameChanged)
        );
    }

    #[test]
    fn exact_fill_uses_opaque_element_and_window_identity_across_reordering() {
        let first = fingerprint(AutoFillSecretField::Password, true);
        let mut overlapping = first.clone();
        overlapping.element_identity = OpaqueAxIdentity::for_test(99);
        overlapping.traversal_path = vec![1, 9];
        let stored = vec![first.clone(), overlapping.clone()];
        let current = vec![overlapping.clone(), first.clone()];

        assert_eq!(
            exact_fill_element_index(&stored, &current, &overlapping, 7),
            Ok(0)
        );

        let mut other_window = current.clone();
        for field in &mut other_window {
            field.window_identity = OpaqueAxIdentity::for_test(88);
        }
        assert_eq!(
            exact_fill_element_index(&stored, &other_window, &overlapping, 7),
            Err(crate::autofill_detected_fill::ExactAxFillError::WindowChanged)
        );
    }

    #[test]
    fn exact_fill_rejects_pid_reuse_identity_change_and_focus_switch() {
        let password = fingerprint(AutoFillSecretField::Password, true);
        let stored = vec![password.clone()];

        let mut reused_pid = password.clone();
        reused_pid.window_identity = OpaqueAxIdentity::for_test(77);
        reused_pid.element_identity = OpaqueAxIdentity::for_test(78);
        assert_eq!(
            exact_fill_element_index(&stored, &[reused_pid], &password, 7),
            Err(crate::autofill_detected_fill::ExactAxFillError::WindowChanged)
        );

        let mut focus_switched = password.clone();
        focus_switched.focused = false;
        assert_eq!(
            exact_fill_element_index(&stored, &[focus_switched], &password, 7),
            Err(crate::autofill_detected_fill::ExactAxFillError::FrameChanged)
        );
    }

    #[test]
    fn guarded_paste_restores_every_clipboard_item_and_non_text_flavor() {
        let original = vec![
            vec![
                ("public.utf8-plain-text".to_owned(), b"public".to_vec()),
                ("public.png".to_owned(), vec![0, 1, 2, 3]),
            ],
            vec![("com.example.custom".to_owned(), vec![9, 8, 7])],
        ];
        let state = Arc::new(Mutex::new(FakeClipboardState {
            items: original.clone(),
            generation: 4,
            clears: 0,
        }));
        let mut clipboard = FakeSecureClipboard {
            state: Arc::clone(&state),
            fail_restore: false,
            fail_write: None,
            external_on_untouched_failure: false,
        };
        let sequence = Arc::new(Mutex::new(Vec::new()));
        let observed = Arc::clone(&sequence);

        assert_eq!(
            guarded_paste_transaction(&mut clipboard, "owned-secret", move |_| {
                observed
                    .lock()
                    .unwrap()
                    .extend(["focus", "revalidate", "post"]);
                Ok(())
            }),
            Ok(())
        );
        assert_eq!(state.lock().unwrap().items, original);
        assert_eq!(
            *sequence.lock().unwrap(),
            vec!["focus", "revalidate", "post"]
        );
    }

    #[test]
    fn guarded_paste_preserves_external_mutation_and_cleans_up_on_failures_and_panic() {
        let original = vec![vec![("public.png".to_owned(), vec![1, 2, 3])]];
        for mode in ["event", "restore", "panic"] {
            let state = Arc::new(Mutex::new(FakeClipboardState {
                items: original.clone(),
                generation: 10,
                clears: 0,
            }));
            let mut clipboard = FakeSecureClipboard {
                state: Arc::clone(&state),
                fail_restore: mode == "restore",
                fail_write: None,
                external_on_untouched_failure: false,
            };
            let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                guarded_paste_transaction(&mut clipboard, "owned-secret", |_| match mode {
                    "event" => Err(()),
                    "panic" => panic!("injected panic after clipboard write"),
                    _ => Ok(()),
                })
            }));
            if mode == "panic" {
                assert!(run.is_err());
                assert_eq!(state.lock().unwrap().items, original);
            } else if mode == "restore" {
                assert_eq!(run.unwrap(), Err(()));
                let state = state.lock().unwrap();
                assert!(state.items.is_empty());
                assert_eq!(state.clears, 1);
            } else {
                assert_eq!(run.unwrap(), Err(()));
                assert_eq!(state.lock().unwrap().items, original);
            }
        }

        let state = Arc::new(Mutex::new(FakeClipboardState {
            items: original,
            generation: 20,
            clears: 0,
        }));
        let mut clipboard = FakeSecureClipboard {
            state: Arc::clone(&state),
            fail_restore: false,
            fail_write: None,
            external_on_untouched_failure: false,
        };
        assert_eq!(
            guarded_paste_transaction(&mut clipboard, "owned-secret", |_| {
                let mut state = state.lock().unwrap();
                state.generation += 1;
                state.items = vec![vec![("external".to_owned(), b"new".to_vec())]];
                Ok(())
            }),
            Ok(())
        );
        assert_eq!(
            state.lock().unwrap().items,
            vec![vec![("external".to_owned(), b"new".to_vec())]]
        );
    }

    #[test]
    fn guarded_paste_delayed_event_completion_fails_and_restores_before_return() {
        let original = vec![vec![("public.png".to_owned(), vec![4, 5, 6])]];
        let state = Arc::new(Mutex::new(FakeClipboardState {
            items: original.clone(),
            generation: 30,
            clears: 0,
        }));
        let mut clipboard = FakeSecureClipboard {
            state: Arc::clone(&state),
            fail_restore: false,
            fail_write: None,
            external_on_untouched_failure: false,
        };
        let started = Instant::now();
        let mut clock_wait = ScriptedPasteClockWait {
            now_values: [
                started,
                started + PASTE_EVENT_ENQUEUE_DEADLINE + Duration::from_millis(1),
            ]
            .into(),
            wait_result: Ok(()),
            during_wait: Some(Box::new(|_| {
                panic!("an event that missed its enqueue deadline must not dwell")
            })),
        };

        assert_eq!(
            guarded_paste_transaction_with_wait(
                &mut clipboard,
                "owned-secret",
                |_| Ok(()),
                &mut clock_wait,
            ),
            Err(())
        );
        assert_eq!(state.lock().unwrap().items, original);
    }

    #[test]
    fn guarded_paste_keeps_secret_for_full_post_enqueue_grace_then_restores() {
        let original = vec![vec![("public.png".to_owned(), vec![4, 5, 6])]];
        let state = Arc::new(Mutex::new(FakeClipboardState {
            items: original.clone(),
            generation: 31,
            clears: 0,
        }));
        let mut clipboard = FakeSecureClipboard {
            state: Arc::clone(&state),
            fail_restore: false,
            fail_write: None,
            external_on_untouched_failure: false,
        };
        let started = Instant::now();
        let saw_secret_through_full_grace = Arc::new(Mutex::new(false));
        let observed = Arc::clone(&saw_secret_through_full_grace);
        let waiting_state = Arc::clone(&state);
        let mut clock_wait = ScriptedPasteClockWait {
            now_values: [started, started, started + Duration::from_millis(250)].into(),
            wait_result: Ok(()),
            during_wait: Some(Box::new(move |duration| {
                let state = waiting_state.lock().unwrap();
                let secret_is_still_owned = state.items.len() == 1
                    && state.items[0].iter().any(|(flavor, data)| {
                        flavor == "public.utf8-plain-text" && data.as_slice() == b"owned-secret"
                    });
                *observed.lock().unwrap() =
                    duration == Duration::from_millis(250) && secret_is_still_owned;
            })),
        };

        assert_eq!(
            guarded_paste_transaction_with_wait(
                &mut clipboard,
                "owned-secret",
                |_| Ok(()),
                &mut clock_wait,
            ),
            Ok(())
        );
        assert!(*saw_secret_through_full_grace.lock().unwrap());
        assert_eq!(state.lock().unwrap().items, original);
    }

    #[test]
    fn guarded_paste_event_failure_skips_grace_and_cleans_immediately() {
        let original = vec![vec![("public.png".to_owned(), vec![7, 8, 9])]];
        let state = Arc::new(Mutex::new(FakeClipboardState {
            items: original.clone(),
            generation: 32,
            clears: 0,
        }));
        let mut clipboard = FakeSecureClipboard {
            state: Arc::clone(&state),
            fail_restore: false,
            fail_write: None,
            external_on_untouched_failure: false,
        };
        let started = Instant::now();
        let mut clock_wait = ScriptedPasteClockWait {
            now_values: [started].into(),
            wait_result: Ok(()),
            during_wait: Some(Box::new(|_| panic!("event failure must not dwell"))),
        };

        assert_eq!(
            guarded_paste_transaction_with_wait(
                &mut clipboard,
                "owned-secret",
                |_| Err(()),
                &mut clock_wait,
            ),
            Err(())
        );
        assert_eq!(state.lock().unwrap().items, original);
    }

    #[test]
    fn guarded_paste_preserves_external_mutation_during_post_enqueue_grace() {
        let original = vec![vec![("public.png".to_owned(), vec![1, 3, 5])]];
        let external = vec![vec![("com.example.external".to_owned(), vec![2, 4, 6])]];
        let state = Arc::new(Mutex::new(FakeClipboardState {
            items: original,
            generation: 33,
            clears: 0,
        }));
        let mut clipboard = FakeSecureClipboard {
            state: Arc::clone(&state),
            fail_restore: false,
            fail_write: None,
            external_on_untouched_failure: false,
        };
        let started = Instant::now();
        let waiting_state = Arc::clone(&state);
        let external_during_wait = external.clone();
        let mut clock_wait = ScriptedPasteClockWait {
            now_values: [started, started, started + Duration::from_millis(250)].into(),
            wait_result: Ok(()),
            during_wait: Some(Box::new(move |_| {
                let mut state = waiting_state.lock().unwrap();
                state.generation += 1;
                state.items = external_during_wait.clone();
            })),
        };

        assert_eq!(
            guarded_paste_transaction_with_wait(
                &mut clipboard,
                "owned-secret",
                |_| Ok(()),
                &mut clock_wait,
            ),
            Ok(())
        );
        assert_eq!(state.lock().unwrap().items, external);
    }

    #[test]
    fn guarded_paste_clock_anomaly_or_interruption_fails_closed_without_lock_leak() {
        let started = Instant::now();
        for (wait_result, completed_at) in [
            (Err(()), None),
            (Ok(()), Some(started - Duration::from_millis(1))),
            (Ok(()), Some(started + Duration::from_millis(249))),
        ] {
            let original = vec![vec![("public.png".to_owned(), vec![8, 6, 4])]];
            let state = Arc::new(Mutex::new(FakeClipboardState {
                items: original.clone(),
                generation: 34,
                clears: 0,
            }));
            let mut clipboard = FakeSecureClipboard {
                state: Arc::clone(&state),
                fail_restore: false,
                fail_write: None,
                external_on_untouched_failure: false,
            };
            let mut now_values = std::collections::VecDeque::from([started, started]);
            if let Some(completed_at) = completed_at {
                now_values.push_back(completed_at);
            }
            let mut clock_wait = ScriptedPasteClockWait {
                now_values,
                wait_result,
                during_wait: None,
            };
            let transaction_lock = Mutex::new(());

            assert_eq!(
                guarded_paste_transaction_with_wait_and_lock(
                    &mut clipboard,
                    "owned-secret",
                    |_| Ok(()),
                    &mut clock_wait,
                    &transaction_lock,
                ),
                Err(())
            );
            assert_eq!(state.lock().unwrap().items, original);
            assert!(transaction_lock.try_lock().is_ok());
        }
    }

    #[test]
    fn exact_paste_event_revalidates_focus_at_every_pre_post_seam() {
        for fail_at in ["focus", "first-revalidate", "final-revalidate", "event"] {
            let sequence = std::cell::RefCell::new(Vec::new());
            let validations = Cell::new(0);
            let result = exact_paste_event_with(
                Instant::now() + Duration::from_secs(1),
                || {
                    sequence.borrow_mut().push("focus");
                    (fail_at != "focus").then_some(()).ok_or(())
                },
                || {
                    sequence.borrow_mut().push("revalidate");
                    let call = validations.get();
                    validations.set(call + 1);
                    match (fail_at, call) {
                        ("first-revalidate", 0) | ("final-revalidate", 1) => Err(()),
                        _ => Ok(()),
                    }
                },
                || {
                    sequence.borrow_mut().push("post");
                    (fail_at != "event").then_some(()).ok_or(())
                },
                Instant::now,
            );
            assert_eq!(result, Err(()));
            if fail_at != "event" {
                assert!(!sequence.borrow().contains(&"post"));
            }
        }
    }

    #[test]
    fn clipboard_write_failure_never_claims_or_overwrites_an_external_generation() {
        let state = Arc::new(Mutex::new(FakeClipboardState {
            items: vec![vec![("original".to_owned(), b"old".to_vec())]],
            generation: 40,
            clears: 0,
        }));
        let mut clipboard = FakeSecureClipboard {
            state: Arc::clone(&state),
            fail_restore: false,
            fail_write: Some(ClipboardWriteError::Untouched),
            external_on_untouched_failure: true,
        };

        assert_eq!(
            guarded_paste_transaction(&mut clipboard, "owned-secret", |_| Ok(())),
            Err(())
        );
        assert_eq!(
            state.lock().unwrap().items,
            vec![vec![("external".to_owned(), b"new".to_vec())]]
        );
    }
}
