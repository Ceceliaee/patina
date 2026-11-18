use super::{Machines, Packet, handle, merge, visible};
use worker::*;

#[event(fetch)]
pub async fn fetch(request: Request, env: Env, _: Context) -> Result<Response> {
    env.durable_object("REMOTE_STATUS_BRIDGE")?
        .get_by_name("default")?
        .fetch_with_request(request)
        .await
}

#[durable_object]
pub struct RemoteStatusBridge {
    state: State,
    env: Env,
}

impl DurableObject for RemoteStatusBridge {
    fn new(state: State, env: Env) -> Self {
        Self { state, env }
    }

    async fn fetch(&self, request: Request) -> Result<Response> {
        match request.url()?.path() {
            "/ws" => {
                if !request
                    .headers()
                    .get("upgrade")?
                    .is_some_and(|s| s.eq_ignore_ascii_case("websocket"))
                {
                    return Response::error("Expected WebSocket", 426);
                }
                let pair = WebSocketPair::new()?;
                self.state.accept_web_socket(&pair.server);
                Response::from_websocket(pair.client)
            }
            "/state" => {
                let mut response = if request.method() == Method::Options {
                    Response::empty()?.with_status(204)
                } else {
                    let now = Date::now().as_millis() as i64;
                    let machines = self
                        .state
                        .storage()
                        .get::<Machines>("machines")
                        .await?
                        .unwrap_or_default();
                    let mut response = Response::from_json(
                        &serde_json::json!({"updatedAtMs":now, "machines":visible(machines,now)}),
                    )?;
                    response.headers_mut().set("cache-control", "no-store")?;
                    response
                };
                let headers = response.headers_mut();
                headers.set("access-control-allow-origin", "*")?;
                headers.set("access-control-allow-methods", "GET, OPTIONS")?;
                headers.set("access-control-allow-headers", "Content-Type")?;
                Ok(response)
            }
            _ => Response::error("Not found", 404),
        }
    }

    async fn websocket_message(
        &self,
        ws: WebSocket,
        message: WebSocketIncomingMessage,
    ) -> Result<()> {
        let bytes = match message {
            WebSocketIncomingMessage::String(s) => s.into_bytes(),
            WebSocketIncomingMessage::Binary(b) => b,
        };
        let authorized = ws.deserialize_attachment()?.unwrap_or(false);
        let token = if authorized {
            String::new()
        } else {
            self.env
                .secret("REMOTE_STATUS_BRIDGE_TOKEN")
                .map(|s| s.to_string())
                .unwrap_or_default()
        };
        match handle(authorized, &token, &bytes, Date::now().as_millis() as i64) {
            Packet::Authenticated => {
                ws.serialize_attachment(true)?;
                ws.send_with_str(r#"{"type":"auth-ok"}"#)
            }
            Packet::RejectAuth => {
                ws.send_with_str(r#"{"type":"auth-failed"}"#)?;
                ws.close(Some(1008), Some("auth failed"))
            }
            Packet::Close(code, reason) => ws.close(Some(code), Some(reason)),
            Packet::Pong => ws.send_with_str(r#"{"type":"pong"}"#),
            Packet::Ignore => Ok(()),
            Packet::Snapshot(machine) => {
                // Durable Object input gates keep consecutive storage operations ordered.
                let storage = self.state.storage();
                let mut machines = storage
                    .get::<Machines>("machines")
                    .await?
                    .unwrap_or_default();
                merge(&mut machines, machine);
                storage.put("machines", machines).await
            }
        }
    }

    async fn websocket_close(&self, _: WebSocket, _: usize, _: String, _: bool) -> Result<()> {
        Ok(())
    }

    async fn websocket_error(&self, ws: WebSocket, _: Error) -> Result<()> {
        ws.close(Some(1011), Some("socket error"))
    }
}
