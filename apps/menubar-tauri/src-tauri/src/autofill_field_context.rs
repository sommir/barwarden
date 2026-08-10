use crate::accessibility_focus::AxFrame;
use crate::autofill_contract::AutoFillSecretField;
use unicode_normalization::UnicodeNormalization;

const SECURE_ROLE_SCORE: u16 = 100;
const LINKED_TITLE_SCORE: u16 = 80;
const TITLE_OR_PLACEHOLDER_SCORE: u16 = 70;
const IDENTIFIER_SCORE: u16 = 55;
const DESCRIPTION_SCORE: u16 = 45;
const SIBLING_FORM_SCORE: u16 = 35;
const ALIGNMENT_SCORE: u16 = 15;
const AMBIGUOUS_SCORE: u16 = 20;
const HIGH_SCORE: u16 = 80;
const HIGH_MARGIN: u16 = 25;
const MEDIUM_SCORE: u16 = 55;
const MEDIUM_MARGIN: u16 = 15;
const MAX_EVIDENCE_SCALARS: usize = 255;

const USERNAME: usize = 0;
const EMAIL: usize = 1;
const PASSWORD: usize = 2;
const ONE_TIME_CODE: usize = 3;
const KIND_COUNT: usize = 4;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DetectedFieldKind {
    Username,
    Email,
    Password,
    OneTimeCode,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FieldConfidence {
    High,
    Medium,
    Low,
}

#[derive(Clone, Debug)]
pub struct SemanticFieldObservation {
    pub role: String,
    pub subrole: Option<String>,
    pub role_description: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub help: Option<String>,
    pub placeholder: Option<String>,
    pub identifier: Option<String>,
    pub linked_title: Option<String>,
    pub frame: AxFrame,
    pub editable: bool,
    pub enabled: bool,
    pub focused: bool,
    pub container_path: Vec<u16>,
}

#[derive(Clone, Debug)]
pub struct DetectedField {
    pub kind: DetectedFieldKind,
    pub secret_field: Option<AutoFillSecretField>,
    pub confidence: FieldConfidence,
    pub score: u16,
    pub frame: AxFrame,
    pub focused: bool,
    pub container_path: Vec<u16>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DetectedAction {
    Field { field: AutoFillSecretField },
    Form { fields: Vec<AutoFillSecretField> },
    Choose,
}

pub fn classify_fields(input: &[SemanticFieldObservation]) -> Vec<DetectedField> {
    let mut candidates = input.iter().map(base_candidates).collect::<Vec<_>>();

    for (index, observation) in input.iter().enumerate() {
        if !eligible(observation) || is_secure_role(observation) {
            continue;
        }

        let has_secure_sibling = input.iter().enumerate().any(|(other_index, other)| {
            other_index != index
                && same_container(observation, other)
                && eligible(other)
                && is_secure_role(other)
        });
        if has_secure_sibling {
            add_score(&mut candidates[index], USERNAME, SIBLING_FORM_SCORE);
        }
    }

    for (index, observation) in input.iter().enumerate() {
        if !eligible(observation) || !has_any_score(&candidates[index]) {
            continue;
        }
        let has_aligned_peer = input.iter().enumerate().any(|(other_index, other)| {
            other_index != index
                && eligible(other)
                && same_container(observation, other)
                && has_any_score(&candidates[other_index])
                && frames_align(observation.frame, other.frame)
        });
        if has_aligned_peer {
            add_score_to_scored_kinds(&mut candidates[index], ALIGNMENT_SCORE);
        }
    }

    input
        .iter()
        .enumerate()
        .map(|(index, observation)| detected_field(observation, candidates[index]))
        .collect()
}

pub fn detect_action(fields: &[DetectedField]) -> DetectedAction {
    let mut form_actions = Vec::new();
    for (index, field) in fields.iter().enumerate() {
        if fields[..index]
            .iter()
            .any(|previous| previous.container_path == field.container_path)
        {
            continue;
        }
        let group = fields
            .iter()
            .filter(|candidate| candidate.container_path == field.container_path)
            .collect::<Vec<_>>();
        if let Some(action) = safe_form_action(&group) {
            form_actions.push(action);
        }
    }

    if form_actions.len() == 1 {
        return form_actions.remove(0);
    }
    if form_actions.len() > 1 {
        return DetectedAction::Choose;
    }

    let classified = fields
        .iter()
        .filter(|field| field.kind != DetectedFieldKind::Unknown)
        .collect::<Vec<_>>();
    match classified.as_slice() {
        [field]
            if field.focused
                && field.confidence != FieldConfidence::Low
                && field.secret_field.is_some() =>
        {
            DetectedAction::Field {
                field: field.secret_field.expect("checked above"),
            }
        }
        _ => DetectedAction::Choose,
    }
}

fn base_candidates(observation: &SemanticFieldObservation) -> [u16; KIND_COUNT] {
    if !eligible(observation) {
        return [0; KIND_COUNT];
    }

    let mut scores = [0; KIND_COUNT];
    if is_secure_role(observation) {
        scores[PASSWORD] = SECURE_ROLE_SCORE;
        return scores;
    }

    add_text_evidence(
        &mut scores,
        observation.linked_title.as_deref(),
        LINKED_TITLE_SCORE,
    );
    add_combined_text_evidence(
        &mut scores,
        [
            observation.title.as_deref(),
            observation.placeholder.as_deref(),
        ],
        TITLE_OR_PLACEHOLDER_SCORE,
    );
    add_text_evidence(
        &mut scores,
        observation.identifier.as_deref(),
        IDENTIFIER_SCORE,
    );
    add_combined_text_evidence(
        &mut scores,
        [
            observation.role_description.as_deref(),
            observation.description.as_deref(),
            observation.help.as_deref(),
        ],
        DESCRIPTION_SCORE,
    );
    scores
}

fn detected_field(
    observation: &SemanticFieldObservation,
    scores: [u16; KIND_COUNT],
) -> DetectedField {
    let (kind, score, confidence) = select_kind(observation, scores);
    let conflicting_password =
        kind == DetectedFieldKind::Password && has_password_conflict(observation);
    let secret_field = (!conflicting_password)
        .then(|| match kind {
            DetectedFieldKind::Username | DetectedFieldKind::Email => {
                Some(AutoFillSecretField::Username)
            }
            DetectedFieldKind::Password => Some(AutoFillSecretField::Password),
            DetectedFieldKind::OneTimeCode => Some(AutoFillSecretField::Totp),
            DetectedFieldKind::Unknown => None,
        })
        .flatten();

    DetectedField {
        kind,
        secret_field,
        confidence,
        score,
        frame: observation.frame,
        focused: observation.focused,
        container_path: observation.container_path.clone(),
    }
}

fn select_kind(
    observation: &SemanticFieldObservation,
    scores: [u16; KIND_COUNT],
) -> (DetectedFieldKind, u16, FieldConfidence) {
    if !eligible(observation) {
        return (DetectedFieldKind::Unknown, 0, FieldConfidence::Low);
    }
    if is_secure_role(observation) {
        return (
            DetectedFieldKind::Password,
            SECURE_ROLE_SCORE,
            FieldConfidence::High,
        );
    }

    let mut ranked = scores
        .into_iter()
        .enumerate()
        .collect::<Vec<(usize, u16)>>();
    ranked.sort_by(|(left_kind, left_score), (right_kind, right_score)| {
        right_score
            .cmp(left_score)
            .then_with(|| left_kind.cmp(right_kind))
    });
    let (top_kind, top_score) = ranked[0];
    let second_score = ranked[1].1;
    if top_score == 0 || top_score == second_score {
        return (DetectedFieldKind::Unknown, top_score, FieldConfidence::Low);
    }
    let margin = top_score - second_score;
    let confidence = if top_score >= HIGH_SCORE && margin >= HIGH_MARGIN {
        FieldConfidence::High
    } else if top_score >= MEDIUM_SCORE && margin >= MEDIUM_MARGIN {
        FieldConfidence::Medium
    } else {
        FieldConfidence::Low
    };
    (kind_for_index(top_kind), top_score, confidence)
}

fn safe_form_action(group: &[&DetectedField]) -> Option<DetectedAction> {
    if group
        .first()
        .is_none_or(|field| field.container_path.is_empty())
    {
        return None;
    }
    if !group.iter().any(|field| field.focused) {
        return None;
    }
    if group
        .iter()
        .any(|field| field.kind == DetectedFieldKind::Password && field.secret_field.is_none())
    {
        return None;
    }
    if group
        .iter()
        .any(|field| field.secret_field.is_some() && field.confidence == FieldConfidence::Low)
    {
        return None;
    }
    if group.iter().any(|field| !valid_frame(field.frame)) {
        return None;
    }

    let secrets = group
        .iter()
        .filter_map(|field| field.secret_field)
        .collect::<Vec<_>>();
    let usernames = secrets
        .iter()
        .filter(|field| **field == AutoFillSecretField::Username)
        .count();
    let passwords = secrets
        .iter()
        .filter(|field| **field == AutoFillSecretField::Password)
        .count();
    let totps = secrets
        .iter()
        .filter(|field| **field == AutoFillSecretField::Totp)
        .count();
    if usernames > 1 || passwords != 1 || totps > 1 {
        return None;
    }
    if !group.iter().any(|field| {
        field.focused && field.confidence != FieldConfidence::Low && field.secret_field.is_some()
    }) {
        return None;
    }

    let mut fields = Vec::new();
    if usernames == 1 {
        fields.push(AutoFillSecretField::Username);
    }
    fields.push(AutoFillSecretField::Password);
    if totps == 1 {
        fields.push(AutoFillSecretField::Totp);
    }
    Some(DetectedAction::Form { fields })
}

fn eligible(observation: &SemanticFieldObservation) -> bool {
    observation.editable && observation.enabled && is_supported_text_role(observation)
}

fn is_supported_text_role(observation: &SemanticFieldObservation) -> bool {
    matches!(
        observation.role.as_str(),
        "AXTextField" | "AXSecureTextField"
    )
}

fn is_secure_role(observation: &SemanticFieldObservation) -> bool {
    observation.role == "AXSecureTextField"
        || observation.subrole.as_deref() == Some("AXSecureTextField")
}

fn same_container(left: &SemanticFieldObservation, right: &SemanticFieldObservation) -> bool {
    !left.container_path.is_empty() && left.container_path == right.container_path
}

fn frames_align(left: AxFrame, right: AxFrame) -> bool {
    valid_frame(left)
        && valid_frame(right)
        && (left.x - right.x).abs() <= 2.0
        && (left.width - right.width).abs() <= 2.0
}

fn valid_frame(frame: AxFrame) -> bool {
    frame.x.is_finite()
        && frame.y.is_finite()
        && frame.width.is_finite()
        && frame.height.is_finite()
        && frame.width > 0.0
        && frame.height > 0.0
}

fn add_text_evidence(scores: &mut [u16; KIND_COUNT], text: Option<&str>, weight: u16) {
    add_combined_text_evidence(scores, [text], weight);
}

fn add_combined_text_evidence<const N: usize>(
    scores: &mut [u16; KIND_COUNT],
    texts: [Option<&str>; N],
    weight: u16,
) {
    let mut matches = [false; KIND_COUNT];
    let mut ambiguous = [false; KIND_COUNT];
    for text in texts.into_iter().flatten() {
        if !within_evidence_limit(text) {
            continue;
        }
        let normalized = normalize(text);
        let field_matches = classify_text(&normalized);
        for kind in 0..KIND_COUNT {
            matches[kind] |= field_matches[kind];
            ambiguous[kind] |= ambiguous_text(&normalized)[kind];
        }
    }
    for kind in 0..KIND_COUNT {
        if matches[kind] {
            add_score(scores, kind, weight);
        } else if ambiguous[kind] {
            add_score(scores, kind, AMBIGUOUS_SCORE);
        }
    }
}

fn add_score(scores: &mut [u16; KIND_COUNT], kind: usize, score: u16) {
    scores[kind] = scores[kind].saturating_add(score).min(SECURE_ROLE_SCORE);
}

fn add_score_to_scored_kinds(scores: &mut [u16; KIND_COUNT], score: u16) {
    for kind in 0..KIND_COUNT {
        if scores[kind] > 0 {
            add_score(scores, kind, score);
        }
    }
}

fn has_any_score(scores: &[u16; KIND_COUNT]) -> bool {
    scores.iter().any(|score| *score > 0)
}

fn within_evidence_limit(text: &str) -> bool {
    has_at_most_evidence_scalars(text.chars())
}

fn has_at_most_evidence_scalars(scalars: impl Iterator<Item = char>) -> bool {
    scalars.take(MAX_EVIDENCE_SCALARS + 1).count() <= MAX_EVIDENCE_SCALARS
}

fn normalize(text: &str) -> String {
    let composed = text.nfc().collect::<String>();
    let mut normalized = String::new();
    let mut previous_is_lowercase = false;
    for character in composed.chars() {
        if character.is_alphanumeric() {
            if character.is_uppercase() && previous_is_lowercase {
                normalized.push(' ');
            }
            normalized.extend(character.to_lowercase());
            previous_is_lowercase = character.is_lowercase();
        } else {
            if !normalized.ends_with(' ') {
                normalized.push(' ');
            }
            previous_is_lowercase = false;
        }
    }
    normalized.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn classify_text(text: &str) -> [bool; KIND_COUNT] {
    [
        matches_phrase(
            text,
            &[
                "username",
                "user name",
                "user id",
                "用户名",
                "使用者名稱",
                "使用者名称",
                "帳號",
                "账号",
            ],
        ),
        matches_phrase(
            text,
            &[
                "email",
                "e mail",
                "email address",
                "电子邮件",
                "電子郵件",
                "邮箱",
                "郵箱",
            ],
        ),
        matches_phrase(text, &["password", "pass word", "密码", "密碼"]),
        matches_phrase(
            text,
            &[
                "otp",
                "one time code",
                "verification code",
                "security code",
                "authenticator code",
                "验证码",
                "驗證碼",
                "动态密码",
                "動態密碼",
            ],
        ),
    ]
}

fn ambiguous_text(text: &str) -> [bool; KIND_COUNT] {
    [
        matches_phrase(text, &["account"]),
        false,
        matches_phrase(text, &["passcode"]),
        false,
    ]
}

fn matches_phrase(text: &str, phrases: &[&str]) -> bool {
    let padded = format!(" {text} ");
    phrases.iter().any(|phrase| {
        let normalized_phrase = normalize(phrase);
        if normalized_phrase
            .chars()
            .any(|character| !character.is_ascii())
        {
            text.contains(&normalized_phrase)
        } else {
            padded.contains(&format!(" {normalized_phrase} "))
        }
    })
}

fn has_password_conflict(observation: &SemanticFieldObservation) -> bool {
    [
        observation.linked_title.as_deref(),
        observation.title.as_deref(),
        observation.placeholder.as_deref(),
        observation.identifier.as_deref(),
        observation.role_description.as_deref(),
        observation.description.as_deref(),
        observation.help.as_deref(),
    ]
    .into_iter()
    .flatten()
    .filter(|text| within_evidence_limit(text))
    .map(normalize)
    .any(|text| {
        matches_phrase(
            &text,
            &[
                "new password",
                "confirm password",
                "repeat password",
                "新密码",
                "新密碼",
                "确认密码",
                "確認密碼",
            ],
        )
    })
}

fn kind_for_index(index: usize) -> DetectedFieldKind {
    match index {
        USERNAME => DetectedFieldKind::Username,
        EMAIL => DetectedFieldKind::Email,
        PASSWORD => DetectedFieldKind::Password,
        ONE_TIME_CODE => DetectedFieldKind::OneTimeCode,
        _ => DetectedFieldKind::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_fields, detect_action, has_at_most_evidence_scalars, DetectedAction,
        DetectedFieldKind, FieldConfidence, SemanticFieldObservation, MAX_EVIDENCE_SCALARS,
    };
    use crate::accessibility_focus::AxFrame;
    use crate::autofill_contract::AutoFillSecretField;
    use std::cell::Cell;
    use std::rc::Rc;

    #[derive(Clone)]
    struct FieldFixture(SemanticFieldObservation);

    impl FieldFixture {
        fn new(role: &str) -> Self {
            Self(SemanticFieldObservation {
                role: role.into(),
                subrole: None,
                role_description: None,
                title: None,
                description: None,
                help: None,
                placeholder: None,
                identifier: None,
                linked_title: None,
                frame: AxFrame {
                    x: 10.0,
                    y: 10.0,
                    width: 200.0,
                    height: 24.0,
                },
                editable: true,
                enabled: true,
                focused: false,
                container_path: vec![1],
            })
        }

        fn placeholder(mut self, value: &str) -> Self {
            self.0.placeholder = Some(value.into());
            self
        }

        fn subrole(mut self, value: &str) -> Self {
            self.0.subrole = Some(value.into());
            self
        }

        fn linked_title(mut self, value: &str) -> Self {
            self.0.linked_title = Some(value.into());
            self
        }

        fn title(mut self, value: &str) -> Self {
            self.0.title = Some(value.into());
            self
        }

        fn identifier(mut self, value: &str) -> Self {
            self.0.identifier = Some(value.into());
            self
        }

        fn description(mut self, value: &str) -> Self {
            self.0.description = Some(value.into());
            self
        }

        fn help(mut self, value: &str) -> Self {
            self.0.help = Some(value.into());
            self
        }

        fn focused(mut self) -> Self {
            self.0.focused = true;
            self
        }

        fn container(mut self, value: u16) -> Self {
            self.0.container_path = vec![value];
            self
        }

        fn without_container(mut self) -> Self {
            self.0.container_path.clear();
            self
        }

        fn frame(mut self, x: f64, y: f64, width: f64, height: f64) -> Self {
            self.0.frame = AxFrame {
                x,
                y,
                width,
                height,
            };
            self
        }

        fn build(self) -> SemanticFieldObservation {
            self.0
        }
    }

    fn field(role: &str) -> FieldFixture {
        FieldFixture::new(role)
    }

    fn username_password_form() -> Vec<SemanticFieldObservation> {
        vec![
            field("AXTextField")
                .placeholder("Username")
                .focused()
                .build(),
            field("AXSecureTextField").placeholder("Password").build(),
        ]
    }

    fn new_confirm_password_form() -> Vec<SemanticFieldObservation> {
        vec![
            field("AXTextField")
                .placeholder("Username")
                .focused()
                .build(),
            field("AXSecureTextField")
                .placeholder("New password")
                .build(),
            field("AXSecureTextField")
                .placeholder("Confirm password")
                .build(),
        ]
    }

    #[test]
    fn classifies_secure_email_username_and_otp_without_reading_values() {
        let detected = classify_fields(&[
            field("AXTextField").placeholder("Email").focused().build(),
            field("AXSecureTextField").placeholder("Password").build(),
            field("AXTextField").linked_title("验证码").build(),
        ]);

        assert_eq!(detected[0].kind, DetectedFieldKind::Email);
        assert_eq!(detected[0].confidence, FieldConfidence::High);
        assert_eq!(detected[1].kind, DetectedFieldKind::Password);
        assert_eq!(detected[1].score, 100);
        assert_eq!(detected[2].kind, DetectedFieldKind::OneTimeCode);
    }

    #[test]
    fn secure_text_subrole_is_conclusive_without_semantic_strings() {
        let detected = classify_fields(&[field("AXTextField")
            .subrole("AXSecureTextField")
            .focused()
            .build()]);

        assert_eq!(detected[0].kind, DetectedFieldKind::Password);
        assert_eq!(detected[0].confidence, FieldConfidence::High);
        assert_eq!(detected[0].score, 100);
        assert_eq!(
            detect_action(&detected),
            DetectedAction::Form {
                fields: vec![AutoFillSecretField::Password],
            }
        );
    }

    #[test]
    fn detects_only_safe_single_password_login_forms() {
        assert_eq!(
            detect_action(&classify_fields(&username_password_form())),
            DetectedAction::Form {
                fields: vec![AutoFillSecretField::Username, AutoFillSecretField::Password]
            }
        );
        assert_eq!(
            detect_action(&classify_fields(&new_confirm_password_form())),
            DetectedAction::Choose
        );
    }

    #[test]
    fn uses_fixed_evidence_scores_and_confidence_bands() {
        let detected = classify_fields(&[
            field("AXTextField").linked_title("email").build(),
            field("AXTextField")
                .placeholder("username")
                .container(2)
                .build(),
            field("AXTextField")
                .identifier("emailAddress")
                .container(3)
                .build(),
            field("AXTextField")
                .description("one time code")
                .container(4)
                .build(),
            field("AXTextField").help("password").container(5).build(),
            field("AXTextField")
                .placeholder("account")
                .container(6)
                .build(),
            field("AXTextField")
                .placeholder("passcode")
                .container(7)
                .build(),
            field("AXTextField")
                .placeholder("email password")
                .container(8)
                .build(),
        ]);

        let expected = [
            (DetectedFieldKind::Email, FieldConfidence::High, 80),
            (DetectedFieldKind::Username, FieldConfidence::Medium, 70),
            (DetectedFieldKind::Email, FieldConfidence::Medium, 55),
            (DetectedFieldKind::OneTimeCode, FieldConfidence::Low, 45),
            (DetectedFieldKind::Password, FieldConfidence::Low, 45),
            (DetectedFieldKind::Username, FieldConfidence::Low, 20),
            (DetectedFieldKind::Password, FieldConfidence::Low, 20),
            (DetectedFieldKind::Unknown, FieldConfidence::Low, 70),
        ];

        for (field, expected) in detected.iter().zip(expected) {
            assert_eq!((field.kind, field.confidence, field.score), expected);
        }
    }

    #[test]
    fn recognizes_english_simplified_and_traditional_chinese_metadata() {
        let detected = classify_fields(&[
            field("AXTextField").linked_title("電子郵件").build(),
            field("AXTextField")
                .placeholder("用户名")
                .container(2)
                .build(),
            field("AXSecureTextField")
                .title("密碼")
                .container(3)
                .build(),
            field("AXTextField")
                .description("驗證碼")
                .container(4)
                .build(),
        ]);

        assert_eq!(
            detected.iter().map(|field| field.kind).collect::<Vec<_>>(),
            vec![
                DetectedFieldKind::Email,
                DetectedFieldKind::Username,
                DetectedFieldKind::Password,
                DetectedFieldKind::OneTimeCode,
            ]
        );
    }

    #[test]
    fn adds_sibling_and_alignment_evidence_only_inside_the_same_container() {
        let detected = classify_fields(&[
            field("AXTextField")
                .placeholder("username")
                .frame(10.0, 10.0, 200.0, 24.0)
                .build(),
            field("AXSecureTextField")
                .frame(10.0, 42.0, 200.0, 24.0)
                .build(),
            field("AXTextField")
                .placeholder("username")
                .container(2)
                .frame(10.0, 10.0, 200.0, 24.0)
                .build(),
            field("AXSecureTextField")
                .container(3)
                .frame(10.0, 42.0, 200.0, 24.0)
                .build(),
        ]);

        assert_eq!(
            (detected[0].kind, detected[0].score),
            (DetectedFieldKind::Username, 100)
        );
        assert_eq!(
            (detected[1].kind, detected[1].score),
            (DetectedFieldKind::Password, 100)
        );
        assert_eq!(
            (detected[2].kind, detected[2].score),
            (DetectedFieldKind::Username, 70)
        );
        assert_eq!(
            (detected[3].kind, detected[3].score),
            (DetectedFieldKind::Password, 100)
        );
    }

    #[test]
    fn rejects_ambiguous_duplicates_and_disconnected_form_groups() {
        let duplicate_username = vec![
            field("AXTextField")
                .placeholder("username")
                .focused()
                .build(),
            field("AXTextField").placeholder("email").build(),
            field("AXSecureTextField").build(),
        ];
        let disconnected = vec![
            field("AXTextField")
                .placeholder("username")
                .focused()
                .build(),
            field("AXSecureTextField").container(2).build(),
        ];

        assert_eq!(
            detect_action(&classify_fields(&duplicate_username)),
            DetectedAction::Choose
        );
        assert_eq!(
            detect_action(&classify_fields(&disconnected)),
            DetectedAction::Choose
        );
    }

    #[test]
    fn rejects_a_form_without_a_container_path() {
        let ungrouped = vec![
            field("AXTextField")
                .placeholder("username")
                .focused()
                .without_container()
                .build(),
            field("AXSecureTextField").without_container().build(),
        ];

        assert_eq!(
            detect_action(&classify_fields(&ungrouped)),
            DetectedAction::Choose
        );
    }

    #[test]
    fn action_is_invariant_to_input_order_and_returns_canonical_secret_order() {
        let original = vec![
            field("AXSecureTextField").build(),
            field("AXTextField")
                .placeholder("username")
                .focused()
                .build(),
            field("AXTextField").linked_title("one time code").build(),
        ];
        let permuted = vec![
            original[2].clone(),
            original[0].clone(),
            original[1].clone(),
        ];
        let expected = DetectedAction::Form {
            fields: vec![
                AutoFillSecretField::Username,
                AutoFillSecretField::Password,
                AutoFillSecretField::Totp,
            ],
        };

        assert_eq!(detect_action(&classify_fields(&original)), expected);
        assert_eq!(detect_action(&classify_fields(&permuted)), expected);
    }

    #[test]
    fn handles_non_finite_and_extreme_geometry_without_form_inference() {
        let detected = classify_fields(&[
            field("AXTextField")
                .placeholder("email")
                .focused()
                .frame(f64::NAN, f64::INFINITY, -1.0, f64::MIN)
                .build(),
            field("AXSecureTextField")
                .frame(f64::MAX, f64::MIN, f64::INFINITY, 0.0)
                .build(),
        ]);

        assert_eq!(detected[0].kind, DetectedFieldKind::Email);
        assert_eq!(detect_action(&detected), DetectedAction::Choose);
    }

    #[test]
    fn allows_one_medium_or_high_focused_field_without_form_context() {
        assert_eq!(
            detect_action(&classify_fields(&[field("AXTextField")
                .placeholder("email")
                .focused()
                .build()])),
            DetectedAction::Field {
                field: AutoFillSecretField::Username
            }
        );
    }

    #[test]
    fn detects_password_only_and_password_totp_forms() {
        let password_only = vec![field("AXSecureTextField").focused().build()];
        let password_with_totp = vec![
            field("AXSecureTextField").focused().build(),
            field("AXTextField").linked_title("one time code").build(),
        ];

        assert_eq!(
            detect_action(&classify_fields(&password_only)),
            DetectedAction::Form {
                fields: vec![AutoFillSecretField::Password]
            }
        );
        assert_eq!(
            detect_action(&classify_fields(&password_with_totp)),
            DetectedAction::Form {
                fields: vec![AutoFillSecretField::Password, AutoFillSecretField::Totp]
            }
        );
    }

    #[test]
    fn rejects_low_confidence_same_container_competitors() {
        let duplicate_password = vec![
            field("AXTextField")
                .placeholder("username")
                .focused()
                .build(),
            field("AXSecureTextField").build(),
            field("AXTextField")
                .help("password")
                .frame(500.0, 10.0, 200.0, 24.0)
                .build(),
        ];
        let duplicate_username = vec![
            field("AXTextField")
                .placeholder("username")
                .focused()
                .build(),
            field("AXSecureTextField").build(),
            field("AXTextField")
                .help("account")
                .frame(500.0, 10.0, 200.0, 24.0)
                .build(),
        ];
        let duplicate_totp = vec![
            field("AXTextField")
                .placeholder("username")
                .focused()
                .build(),
            field("AXSecureTextField").build(),
            field("AXTextField")
                .help("one time code")
                .frame(500.0, 10.0, 200.0, 24.0)
                .build(),
        ];

        for input in [duplicate_password, duplicate_username, duplicate_totp] {
            assert_eq!(
                detect_action(&classify_fields(&input)),
                DetectedAction::Choose
            );
        }
    }

    #[test]
    fn caps_each_evidence_source_at_255_unicode_scalars_before_normalization() {
        let at_limit = format!("{} email", "界".repeat(249));
        let beyond_limit = format!("{} email", "界".repeat(250));
        assert_eq!(at_limit.chars().count(), 255);
        assert_eq!(beyond_limit.chars().count(), 256);

        let detected = classify_fields(&[
            field("AXTextField").placeholder(&at_limit).build(),
            field("AXTextField")
                .placeholder(&beyond_limit)
                .container(2)
                .build(),
        ]);

        assert_eq!(
            (detected[0].kind, detected[0].score),
            (DetectedFieldKind::Email, 70)
        );
        assert_eq!(
            (detected[1].kind, detected[1].score),
            (DetectedFieldKind::Unknown, 0)
        );
    }

    #[test]
    fn scalar_limit_stops_after_the_first_scalar_beyond_the_cap() {
        let consumed = Rc::new(Cell::new(0));
        let iterator = CountingScalars {
            remaining: MAX_EVIDENCE_SCALARS + 100,
            consumed: consumed.clone(),
        };

        assert!(!has_at_most_evidence_scalars(iterator));
        assert_eq!(consumed.get(), MAX_EVIDENCE_SCALARS + 1);
    }

    struct CountingScalars {
        remaining: usize,
        consumed: Rc<Cell<usize>>,
    }

    impl Iterator for CountingScalars {
        type Item = char;

        fn next(&mut self) -> Option<Self::Item> {
            if self.remaining == 0 {
                return None;
            }
            self.remaining -= 1;
            self.consumed.set(self.consumed.get() + 1);
            Some('界')
        }
    }
}
