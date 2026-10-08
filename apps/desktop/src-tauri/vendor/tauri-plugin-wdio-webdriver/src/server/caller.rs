use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, HeaderName, StatusCode},
    middleware::Next,
    response::Response,
};

// The agent launcher uses Node HTTP against this exact loopback address and chosen port. Browsers
// cannot set Host, and a cross-origin browser request supplies an Origin that we refuse.
fn single_header<'a>(headers: &'a HeaderMap, name: HeaderName) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?.to_str().ok()?;
    if values.next().is_some() {
        return None;
    }
    Some(value)
}

fn allowed(headers: &HeaderMap, port: u16) -> bool {
    let endpoint = format!("127.0.0.1:{port}");
    if single_header(headers, header::HOST) != Some(endpoint.as_str()) {
        return false;
    }

    if headers.contains_key(header::ORIGIN) {
        return single_header(headers, header::ORIGIN)
            == Some(format!("http://{endpoint}").as_str());
    }
    true
}

pub(super) async fn require_local_endpoint(
    State(port): State<u16>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if !allowed(request.headers(), port) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(next.run(request).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, middleware, routing::post, Router};
    use tower::ServiceExt;

    async fn response(headers: &[(&str, &str)]) -> StatusCode {
        let router = Router::new()
            .route("/session", post(|| async { StatusCode::OK }))
            .layer(middleware::from_fn_with_state(4445, require_local_endpoint));
        let mut request = Request::builder()
            .method("POST")
            .uri("/session")
            .body(Body::empty())
            .unwrap();
        for (name, value) in headers {
            request.headers_mut().append(
                HeaderName::from_bytes(name.as_bytes()).unwrap(),
                value.parse().unwrap(),
            );
        }
        router.oneshot(request).await.unwrap().status()
    }

    #[tokio::test]
    async fn only_the_chosen_loopback_endpoint_reaches_a_handler() {
        assert_eq!(
            response(&[("host", "127.0.0.1:4445")]).await,
            StatusCode::OK
        );
        assert_eq!(
            response(&[
                ("host", "127.0.0.1:4445"),
                ("origin", "http://127.0.0.1:4445")
            ])
            .await,
            StatusCode::OK
        );

        for headers in [
            vec![],
            vec![("host", "localhost:4445")],
            vec![("host", "127.0.0.1:4446")],
            vec![("host", "evil.example:4445")],
            vec![("host", "127.0.0.1:4445"), ("host", "evil.example:4445")],
            vec![("host", "127.0.0.1:4445, evil.example:4445")],
            vec![
                ("host", "127.0.0.1:4445"),
                ("origin", "https://evil.example"),
            ],
            vec![("host", "127.0.0.1:4445"), ("origin", "null")],
            vec![
                ("host", "127.0.0.1:4445"),
                ("origin", "http://127.0.0.1:4446"),
            ],
            vec![
                ("host", "127.0.0.1:4445"),
                ("origin", "http://127.0.0.1:4445"),
                ("origin", "https://evil.example"),
            ],
        ] {
            assert_eq!(
                response(&headers).await,
                StatusCode::FORBIDDEN,
                "{headers:?}"
            );
        }

        let mut malformed = HeaderMap::new();
        malformed.insert(header::HOST, "127.0.0.1:4445".parse().unwrap());
        malformed.insert(
            header::ORIGIN,
            axum::http::HeaderValue::from_bytes(&[0xff]).unwrap(),
        );
        assert!(!allowed(&malformed, 4445));
    }
}
