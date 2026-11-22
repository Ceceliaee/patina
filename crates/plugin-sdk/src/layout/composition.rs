use serde::{Deserialize, Serialize};

/// Geometry in logical pixels. Controls keep the host theme and interaction states.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Container {
    pub flow: Flow,
    #[serde(default)]
    pub gap: u16,
    #[serde(default)]
    pub align: Align,
    #[serde(default)]
    pub justify: Justify,
    #[serde(default)]
    pub wrap: bool,
    #[serde(default)]
    pub grow: bool,
    #[serde(default)]
    pub surface: Surface,
    pub children: Vec<Node>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Flow {
    Row,
    Column,
    Grid(u8),
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Align {
    Start,
    Center,
    End,
    #[default]
    Stretch,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Justify {
    #[default]
    Start,
    Center,
    End,
    Between,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Surface {
    #[default]
    Plain,
    Card,
    Ruled,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Node {
    Container(Container),
    Title,
    Tabs,
    FormHeading,
    Field(String),
    Submit,
    Cancel,
    List,
    Action(String),
    Text(String),
}

impl Container {
    pub fn new(flow: Flow, gap: u16, children: impl IntoIterator<Item = Node>) -> Self {
        Self {
            flow,
            gap,
            children: children.into_iter().collect(),
            align: Align::Stretch,
            justify: Justify::Start,
            wrap: false,
            grow: false,
            surface: Surface::Plain,
        }
    }
    pub fn aligned(mut self, align: Align) -> Self {
        self.align = align;
        self
    }
    pub fn justified(mut self, justify: Justify) -> Self {
        self.justify = justify;
        self
    }
    pub fn wrapping(mut self) -> Self {
        self.wrap = true;
        self
    }
    pub fn flexible(mut self) -> Self {
        self.grow = true;
        self
    }
    pub fn surface(mut self, surface: Surface) -> Self {
        self.surface = surface;
        self
    }
}

impl From<Container> for Node {
    fn from(value: Container) -> Self {
        Self::Container(value)
    }
}

/// API 2 used a column count. API 3 also accepts the same containers as a page.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Arrangement {
    Columns(u8),
    Layout(Container),
}

#[cfg(test)]
mod tests {
    use super::super::{Editor, Field};
    use serde_json::{Value, json};

    #[test]
    fn reads_old_field_groups_and_new_container_groups() {
        for arrangement in [
            json!({"columns": 2}),
            json!({"layout": {"flow":"row","gap":17,"children":[]}}),
        ] {
            let mut group = json!({"label":"Options","fields":[]});
            group
                .as_object_mut()
                .unwrap()
                .extend(arrangement.as_object().unwrap().clone());
            let field: Field = serde_json::from_value(
                json!({"id":"settings","editor":{"group":group},"grow":false}),
            )
            .unwrap();
            let encoded = serde_json::to_value(&field).unwrap();
            for (key, value) in arrangement.as_object().unwrap() {
                let actual = &encoded["editor"]["group"][key];
                if let Value::Object(properties) = value {
                    for (name, v) in properties {
                        assert_eq!(&actual[name], v);
                    }
                } else {
                    assert_eq!(actual, value);
                }
            }
            assert!(matches!(field.editor, Editor::Group { .. }));
        }
    }
}
