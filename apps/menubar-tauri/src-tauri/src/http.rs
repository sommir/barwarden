use std::{collections::HashMap, time::Duration};

use reqwest::{header::HeaderMap, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
pub async fn http_fetch_json(request: HttpJsonRequest) -> Result<HttpJsonResponse, String> {
    let method = request
        .method
        .parse::<Method>()
        .map_err(|error| format!("Invalid HTTP method: {error}"))?;
    let headers = build_headers(&request.headers)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("HTTP client failed: {error}"))?;

    let (status, text) =
        send_json_request(&client, method, headers, &request.url, request.body).await?;

    parse_http_json_response(status, &text)
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

    use super::{build_headers, parse_http_json_response};

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
}
