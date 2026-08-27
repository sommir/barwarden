use std::{collections::HashMap, sync::Arc, time::Duration};

use crate::autofill_reprompt::AutoFillRepromptReceiptStore;
use reqwest::{header::HeaderMap, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const AUTOFILL_REPROMPT_HEADER: &str = "x-barwarden-autofill-reprompt";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpJsonRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpJsonResponse {
    ok: bool,
    status: u16,
    response_json: Value,
}

#[tauri::command]
pub async fn http_fetch_json(
    mut request: HttpJsonRequest,
    receipts: tauri::State<'_, Arc<AutoFillRepromptReceiptStore>>,
) -> Result<HttpJsonResponse, String> {
    let reprompt_receipt = prepare_reprompt_verification(&mut request, &receipts)?;
    let method = request
        .method
        .parse::<Method>()
        .map_err(|error| format!("Invalid HTTP method: {error}"))?;
    let headers = build_headers(&request.headers)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("HTTP client failed: {error}"))?;

    let sent = send_json_request(&client, method, headers, &request.url, request.body).await;
    let (status, text) = match sent {
        Ok(response) => response,
        Err(error) => {
            if let Some(receipt) = reprompt_receipt.as_deref() {
                receipts.complete_verification(receipt, false);
            }
            return Err(error);
        }
    };
    if let Some(receipt) = reprompt_receipt.as_deref() {
        receipts.complete_verification(receipt, status.is_success());
    }

    parse_http_json_response(status, &text)
}

fn prepare_reprompt_verification(
    request: &mut HttpJsonRequest,
    receipts: &AutoFillRepromptReceiptStore,
) -> Result<Option<String>, String> {
    let receipt_key = request
        .headers
        .keys()
        .find(|key| key.eq_ignore_ascii_case(AUTOFILL_REPROMPT_HEADER))
        .cloned();
    let Some(receipt_key) = receipt_key else {
        return Ok(None);
    };
    let receipt = request.headers.remove(&receipt_key).unwrap_or_default();
    let authorization = request.headers.iter().find_map(|(key, value)| {
        key.eq_ignore_ascii_case("authorization")
            .then_some(value.as_str())
    });
    let valid_body = request
        .body
        .as_deref()
        .and_then(|body| {
            let value: Value = serde_json::from_str(body).ok()?;
            let object = value.as_object()?;
            let hash = object.get("masterPasswordHash")?.as_str()?;
            Some(object.len() == 1 && !hash.is_empty() && hash.len() <= 4_096)
        })
        .unwrap_or(false);
    if request.method != "POST"
        || authorization.is_none_or(|value| !value.starts_with("Bearer ") || value.len() <= 7)
        || !valid_body
        || receipts
            .begin_http_verification(&receipt, &request.url)
            .is_err()
    {
        return Err("HTTP request failed".to_owned());
    }
    Ok(Some(receipt))
}

async fn send_json_request(
    client: &reqwest::Client,
    method: Method,
    headers: HeaderMap,
    url: &str,
    body: Option<String>,
) -> Result<(reqwest::StatusCode, String), String> {
    let mut builder = client.request(method, url).headers(headers);
    if let Some(body) = body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("HTTP request failed: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("HTTP response read failed: {error}"))?;

    Ok((status, text))
}

fn parse_http_json_response(
    status: reqwest::StatusCode,
    text: &str,
) -> Result<HttpJsonResponse, String> {
    let response_json = if text.trim().is_empty() {
        Value::Null
    } else {
        match serde_json::from_str(text) {
            Ok(value) => value,
            Err(error) if status.is_success() => {
                return Err(format!("HTTP response JSON parse failed: {error}"));
            }
            Err(_) => Value::Null,
        }
    };

    Ok(HttpJsonResponse {
        ok: status.is_success(),
        status: status.as_u16(),
        response_json,
    })
}

fn build_headers(headers: &HashMap<String, String>) -> Result<HeaderMap, String> {
    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        let header_name = name
            .parse::<reqwest::header::HeaderName>()
            .map_err(|error| format!("Invalid HTTP header name {name}: {error}"))?;
        let header_value = value
            .parse::<reqwest::header::HeaderValue>()
            .map_err(|error| format!("Invalid HTTP header value for {name}: {error}"))?;
        header_map.insert(header_name, header_value);
    }

    Ok(header_map)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::autofill_contract::AutoFillSecretField;
    use crate::autofill_reprompt::{AutoFillRepromptReceiptStore, AutoFillRepromptScope};

    #[test]
    fn builds_reqwest_headers_from_plain_records() {
        let mut headers = HashMap::new();
        headers.insert("Accept".to_string(), "application/json".to_string());

        let header_map = build_headers(&headers).expect("headers should build");

        assert_eq!(
            header_map.get("Accept").expect("accept header"),
            "application/json"
        );
    }

    #[test]
    fn rejects_invalid_header_names() {
        let mut headers = HashMap::new();
        headers.insert("Bad Header".to_string(), "application/json".to_string());

        let error = build_headers(&headers).expect_err("invalid header should fail");

        assert!(error.contains("Invalid HTTP header name"));
    }

    #[test]
    fn maps_non_success_non_json_fetch_bodies_to_status_envelopes() {
        let response =
            parse_http_json_response(reqwest::StatusCode::UNAUTHORIZED, "private server detail")
                .expect("non-success non-JSON should still return an envelope");

        assert!(!response.ok);
        assert_eq!(response.status, 401);
        assert!(response.response_json.is_null());
    }

    #[test]
    fn native_http_marks_only_an_exact_password_verification_and_strips_the_local_receipt() {
        let store = AutoFillRepromptReceiptStore::default();
        let scope = AutoFillRepromptScope {
            account_id: "account-a".to_owned(),
            candidate_id: "cipher-a".to_owned(),
            field: AutoFillSecretField::Password,
            generation: "00000000-0000-4000-8000-000000000004".to_owned(),
            context_token: "context-a".to_owned(),
        };
        let url = "https://api.example/accounts/verify-password";
        let receipt = store.begin(scope.clone(), url.to_owned()).unwrap();
        let mut request = HttpJsonRequest {
            url: url.to_owned(),
            method: "POST".to_owned(),
            headers: HashMap::from([
                ("Authorization".to_owned(), "Bearer opaque".to_owned()),
                (AUTOFILL_REPROMPT_HEADER.to_owned(), receipt.clone()),
            ]),
            body: Some("{\"masterPasswordHash\":\"opaque-hash\"}".to_owned()),
        };

        assert_eq!(
            prepare_reprompt_verification(&mut request, &store).unwrap(),
            Some(receipt.clone())
        );
        assert!(!request
            .headers
            .keys()
            .any(|key| key.eq_ignore_ascii_case(AUTOFILL_REPROMPT_HEADER)));
        assert!(store.complete_verification(&receipt, true));
        assert!(store.consume_verified(&receipt, &scope));
    }
}
