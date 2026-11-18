use model::views::storage::StorageReply;
use patina_activity_model as model;
use patina_activity_model::{Activity, AppEdit};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    io::{self, BufRead, BufReader, BufWriter, Read, Write},
    sync::mpsc,
    thread,
};

pub mod tools;
pub const APP_ID: &str = "Patina.GPUI.Experimental";
pub const WIRE_VERSION: &str = "2";
pub const MAX_PENDING: usize = 256;
const MAX_FRAME: u64 = 128 * 1024 * 1024;

#[derive(Clone, Copy, Serialize, Deserialize)]
pub enum Target {
    Today,
    Notice { dialog: bool },
    Tool(patina_activity_model::ToolTarget),
    Mini { focus: bool },
}

#[derive(Serialize, Deserialize)]
pub enum Query {
    Update(patina_updater::Request),
    InstallUpdate,
    OpenExternal(String),
    Storage(patina_activity_model::StorageRequest),
    Tools(tools::ToolRequest),
    HistoryMinimum(bool, i64),
    DetailZoom(Option<f32>),
    HistoryZoom(Option<f32>),
    HistoryModes(Option<[u8; 3]>),
    Rules,
    ClassificationMode(bool),
    DeleteApplication(String, Option<patina_activity_model::DeletionImpact>),
    DeleteWebsite(String, Option<patina_activity_model::DeletionImpact>),
    SaveRules(
        Vec<patina_activity_model::AppRule>,
        Option<patina_activity_model::WebDraft>,
        Vec<patina_activity_model::AppLinkEdit>,
        Vec<patina_activity_model::CategoryEdit>,
    ),
    Preferences,
    SavePreferences(
        patina_activity_model::TrackingPreferences,
        patina_activity_model::TrackingPreferences,
    ),
    Trends(Option<(i64, i64)>, patina_activity_model::SeriesKind),
    History {
        day: i64,
        app: Option<String>,
        titles: bool,
        web: bool,
    },
    Today,
    Recent,
    Icons(Vec<String>),
    ChartMode(bool),
    Edit(String, AppEdit),
}

#[derive(Serialize, Deserialize)]
pub enum ToWindow {
    ToolChanged {
        background: bool,
    },
    Open {
        serial: u64,
        revision: u64,
        target: Target,
        activity: Activity,
        paused: bool,
    },
    Changed {
        revision: u64,
        activity: Activity,
        paused: bool,
    },
    Answer(u64, Result<Box<Reply>, RequestError>),
    Exit,
}

#[derive(Serialize, Deserialize)]
pub enum Reply {
    Done,
    Storage(StorageReply),
    Update(patina_updater::Snapshot),
    Zoom(f32),
    HistoryModes(([u8; 3], bool)),
    Rules(model::Rules),
    Deletion(model::DeletionImpact),
    Preferences(model::TrackingPreferences),
    Trends(model::Trends),
    History(model::HistoryDay),
    Today(model::DaySummary),
    Recent(model::Recent),
    Icons(Vec<(String, String)>),
    Tools(ToolList),
    Stopping(Vec<String>),
    Shortcuts(Vec<model::Shortcut>),
    Installed(tools::Installed),
    Notices(Vec<tools::Notice>),
    NoticePreferences(model::NoticePreferences),
    Panel(Vec<tools::Control>),
    Preview(tools::Preview),
}
pub type ToolList = (Vec<tools::Installed>, bool, Option<String>);

#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub enum RequestError {
    Rejected(String),
    Conflict(String),
    Busy,
    SequenceExhausted,
    IncompatibleVersion,
    Disconnected,
}
impl std::fmt::Display for RequestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rejected(message) | Self::Conflict(message) => f.write_str(message),
            Self::IncompatibleVersion => f.write_str("Incompatible desktop protocol version"),
            Self::Busy => f.write_str("Too many desktop requests are pending"),
            Self::SequenceExhausted => f.write_str("Desktop request sequence exhausted"),
            Self::Disconnected => f.write_str("Recording host disconnected"),
        }
    }
}
impl From<String> for RequestError {
    fn from(message: String) -> Self {
        match message.as_str() {
            "remote_name_conflict"
            | "webdav_config_changed"
            | "setting changed since loading"
            | "application changed since loading"
            | "resident settings changed since loading"
            | "deletion scope changed; preview again"
            | "Backup preview expired"
            | "Tool changed since preview; open the package again" => Self::Conflict(message),
            _ => Self::Rejected(message),
        }
    }
}
impl From<&str> for RequestError {
    fn from(message: &str) -> Self {
        message.to_owned().into()
    }
}
impl ToWindow {
    pub fn answer(id: u64, response: Result<Reply, String>) -> Self {
        Self::Answer(id, response.map(Box::new).map_err(RequestError::from))
    }
}

pub trait FromReply: Sized {
    fn from_reply(reply: Reply) -> Result<Self, String>;
}

macro_rules! reply_types {
    ($($variant:ident($ty:ty)),* $(,)?) => {
        $(impl FromReply for $ty {
            fn from_reply(reply: Reply) -> Result<Self, String> {
                match reply { Reply::$variant(value) => Ok(value), _ => Err(concat!("Unexpected response to ", stringify!($variant)).into()) }
            }
        })*
    }
}
reply_types! {
    Storage(StorageReply), Update(patina_updater::Snapshot), Zoom(f32), HistoryModes(([u8;3],bool)),
    Rules(model::Rules), Deletion(model::DeletionImpact), Preferences(model::TrackingPreferences),
    Trends(model::Trends), History(model::HistoryDay), Today(model::DaySummary), Recent(model::Recent),
    Icons(Vec<(String,String)>), Tools(ToolList), Stopping(Vec<String>), Shortcuts(Vec<model::Shortcut>),
    Installed(tools::Installed), Notices(Vec<tools::Notice>), NoticePreferences(model::NoticePreferences),
    Panel(Vec<tools::Control>), Preview(tools::Preview),
}
impl FromReply for () {
    fn from_reply(reply: Reply) -> Result<Self, String> {
        match reply {
            Reply::Done | Reply::Storage(StorageReply::Done) => Ok(()),
            _ => Err("Expected a completed operation".into()),
        }
    }
}
impl FromReply for Option<String> {
    fn from_reply(reply: Reply) -> Result<Self, String> {
        match reply {
            Reply::Storage(StorageReply::Text(text)) => Ok(text),
            _ => Err("Expected a text response".into()),
        }
    }
}
#[derive(Serialize, Deserialize)]
pub enum FromWindow {
    Open(Target),
    MainOpened(Option<usize>),
    MainClosed,
    Idle(u64),
    Query(u64, Box<Query>),
}

pub struct Peer<R>(BufReader<R>);

pub fn handshake<R: Read>(stream: R) -> io::Result<Peer<R>> {
    let mut reader = BufReader::new(stream);
    let mut header = Vec::new();
    reader.by_ref().take(128).read_until(b'\n', &mut header)?;
    if header != preamble().as_bytes() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            RequestError::IncompatibleVersion.to_string(),
        ));
    }
    Ok(Peer(reader))
}

pub fn read_messages<T: DeserializeOwned>(
    Peer(mut reader): Peer<impl Read>,
    mut deliver: impl FnMut(T) -> bool,
) -> io::Result<()> {
    let mut line = Vec::new();
    loop {
        line.clear();
        let size = reader
            .by_ref()
            .take(MAX_FRAME + 1)
            .read_until(b'\n', &mut line)?;
        if size as u64 > MAX_FRAME {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "desktop message exceeds size limit",
            ));
        }
        if size == 0 {
            return Ok(());
        }
        if !deliver(serde_json::from_slice(&line)?) {
            return Ok(());
        }
    }
}

fn preamble() -> String {
    format!(
        "Patina Desktop {} {}\n",
        WIRE_VERSION,
        env!("CARGO_PKG_VERSION")
    )
}

pub fn writer<T: Serialize + Send + 'static>(
    stream: impl Write + Send + 'static,
) -> io::Result<mpsc::Sender<T>> {
    let (tx, rx) = mpsc::channel();
    thread::Builder::new()
        .name("window-pipe-write".into())
        .spawn(move || {
            let mut stream = BufWriter::new(stream);
            if stream
                .write_all(preamble().as_bytes())
                .and_then(|()| stream.flush())
                .is_err()
            {
                return;
            }
            for message in rx {
                if serde_json::to_writer(&mut stream, &message).is_err()
                    || stream
                        .write_all(b"\n")
                        .and_then(|()| stream.flush())
                        .is_err()
                {
                    break;
                }
            }
        })?;
    Ok(tx)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wrong_peer_cannot_deliver_a_request() {
        let mut delivered = false;
        let request = b"Patina Desktop 0 0.0.0\n{\"Idle\":2}\n";
        let err = handshake(&request[..])
            .and_then(|reader| {
                read_messages::<FromWindow>(reader, |_| {
                    delivered = true;
                    true
                })
            })
            .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
        assert!(!delivered);
    }
    #[test]
    fn typed_response_round_trips_over_an_operating_system_pipe() {
        let (input, output) = std::io::pipe().unwrap();
        let messages = writer(output).unwrap();
        messages
            .send(ToWindow::answer(42, Ok(Reply::Zoom(6.0))))
            .unwrap();
        drop(messages);
        let mut received = Vec::new();
        read_messages(handshake(input).unwrap(), |message| {
            received.push(message);
            true
        })
        .unwrap();
        assert!(matches!(
            received.as_slice(),
            [ToWindow::Answer(42, Ok(reply))] if matches!(**reply, Reply::Zoom(6.0))
        ));
        assert!(<model::DaySummary>::from_reply(Reply::Zoom(6.0)).is_err());
    }
}
