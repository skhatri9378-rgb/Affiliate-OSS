use crate::Database;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use tauri_plugin_opener::OpenerExt;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn initialize(c: &Connection) -> Result<(), String> {
    c.execute_batch(include_str!("../../server/schema.sql"))
        .map_err(err)?;
    let has:i64=c.query_row("SELECT count(*) FROM pragma_table_info('managed_links') WHERE name='placement_website_id'",[],|r|r.get(0)).map_err(err)?;
    if has == 0 {
        if let Some(path) = c.path() {
            if !path.is_empty() {
                let backup = format!("{path}.before-websites-{}.sqlite", uuid::Uuid::new_v4());
                c.backup(rusqlite::MAIN_DB, backup, None).map_err(err)?;
            }
        }
        c.execute_batch("BEGIN IMMEDIATE; ALTER TABLE managed_links ADD COLUMN placement_website_id TEXT REFERENCES placement_websites(id) ON DELETE RESTRICT; CREATE INDEX IF NOT EXISTS manager_link_site ON managed_links(placement_website_id); INSERT OR IGNORE INTO manager_migrations VALUES(3,datetime('now')); COMMIT;").map_err(err)?;
    }
    Ok(())
}
const SELECT:&str="SELECT l.id,l.name,l.country_id,l.promoting_website_id,l.placement,l.affiliate_url,l.notes,l.created_at,l.updated_at,c.name,w.name,c.archived,w.archived,h.outcome,h.checked_at,h.http_status,h.detail,l.placement_website_id,s.name,s.archived FROM managed_links l JOIN managed_countries c ON c.id=l.country_id JOIN promoting_websites w ON w.id=l.promoting_website_id LEFT JOIN link_health h ON h.link_id=l.id AND h.checked_url=l.affiliate_url LEFT JOIN placement_websites s ON s.id=l.placement_website_id";
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    #[serde(default)]
    search: String,
    #[serde(default)]
    country_id: String,
    #[serde(default)]
    website_id: String,
    #[serde(default)]
    offset: u32,
    #[serde(default)]
    site_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    id: String,
    name: String,
    archived: bool,
    link_count: i64,
    created_at: String,
    updated_at: String,
}
#[derive(Deserialize)]
pub struct LabelInput {
    kind: String,
    #[serde(default)]
    id: String,
    name: String,
    #[serde(default)]
    archived: bool,
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkInput {
    #[serde(default)]
    site_id: Option<String>,
    #[serde(default)]
    id: String,
    name: String,
    country_id: String,
    website_id: String,
    #[serde(default)]
    placement: String,
    url: String,
    #[serde(default)]
    notes: String,
}
fn table(kind: &str) -> Result<(&str, &str), String> {
    match kind {
        "countries" => Ok(("managed_countries", "country_id")),
        "websites" => Ok(("promoting_websites", "promoting_website_id")),
        "sites" => Ok(("placement_websites", "placement_website_id")),
        _ => Err("Unknown category".into()),
    }
}
pub fn labels(c: &Connection, kind: &str) -> Result<Vec<Label>, String> {
    let (table, fk) = table(kind)?;
    let mut s=c.prepare(&format!("SELECT t.id,t.name,t.archived,(SELECT count(*) FROM managed_links l WHERE l.{fk}=t.id),t.created_at,t.updated_at FROM {table} t ORDER BY t.archived,t.name COLLATE NOCASE,t.id")).map_err(err)?;
    let rows = s
        .query_map([], |r| {
            Ok(Label {
                id: r.get(0)?,
                name: r.get(1)?,
                archived: r.get(2)?,
                link_count: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}
fn link(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(
        json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"countryId":r.get::<_,String>(2)?,"websiteId":r.get::<_,String>(3)?,"placement":r.get::<_,String>(4)?,"url":r.get::<_,String>(5)?,"notes":r.get::<_,String>(6)?,"createdAt":r.get::<_,String>(7)?,"updatedAt":r.get::<_,String>(8)?,"countryName":r.get::<_,String>(9)?,"websiteName":r.get::<_,String>(10)?,"countryArchived":r.get::<_,bool>(11)?,"websiteArchived":r.get::<_,bool>(12)?,"healthStatus":r.get::<_,Option<String>>(13)?,"healthCheckedAt":r.get::<_,Option<String>>(14)?,"healthHttpStatus":r.get::<_,Option<i64>>(15)?,"healthDetail":r.get::<_,Option<String>>(16)?,"siteId":r.get::<_,Option<String>>(17)?,"siteName":r.get::<_,Option<String>>(18)?,"siteArchived":r.get::<_,Option<bool>>(19)?}),
    )
}
pub fn snapshot(c: &Connection, q: Query) -> Result<Value, String> {
    let mut clauses = vec!["1=1".to_string()];
    let mut values = Vec::new();
    if !q.search.trim().is_empty() {
        clauses.push("(l.name LIKE ? ESCAPE '!' OR l.affiliate_url LIKE ? ESCAPE '!')".into());
        let escaped = q
            .search
            .trim()
            .replace('!', "!!")
            .replace('%', "!%")
            .replace('_', "!_");
        values.push(format!("%{escaped}%"));
        values.push(format!("%{escaped}%"));
    }
    if !q.country_id.is_empty() {
        clauses.push("l.country_id=?".into());
        values.push(q.country_id);
    }
    if !q.website_id.is_empty() {
        clauses.push("l.promoting_website_id=?".into());
        values.push(q.website_id.clone());
    }
    if !q.site_id.is_empty() {
        clauses.push("l.placement_website_id=?".into());
        values.push(q.site_id);
    }
    let condition = clauses.join(" AND ");
    let total: i64 = c
        .query_row(
            &format!("SELECT count(*) FROM managed_links l WHERE {condition}"),
            rusqlite::params_from_iter(&values),
            |r| r.get(0),
        )
        .map_err(err)?;
    let mut stmt = c
        .prepare(&format!(
            "{SELECT} WHERE {condition} ORDER BY l.updated_at DESC,l.id LIMIT 30 OFFSET {}",
            q.offset
        ))
        .map_err(err)?;
    let links = stmt
        .query_map(rusqlite::params_from_iter(&values), link)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let project_clause = if q.website_id.is_empty() {
        ""
    } else {
        " WHERE l.promoting_website_id=?"
    };
    let project_values: Vec<&str> = if q.website_id.is_empty() {
        vec![]
    } else {
        vec![q.website_id.as_str()]
    };
    let mut recent = c
        .prepare(&format!(
            "{SELECT}{project_clause} ORDER BY l.updated_at DESC,l.id LIMIT 6"
        ))
        .map_err(err)?;
    let recent = recent
        .query_map(rusqlite::params_from_iter(&project_values), link)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let count = |t: &str| -> Result<i64, String> {
        c.query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0))
            .map_err(err)
    };
    let metrics = if q.website_id.is_empty() {
        json!({"links":count("managed_links")?,"countries":count("managed_countries")?,"websites":count("placement_websites")?})
    } else {
        let (links,countries,sites):(i64,i64,i64)=c.query_row("SELECT count(*),count(DISTINCT country_id),count(DISTINCT placement_website_id) FROM managed_links WHERE promoting_website_id=?1",[&q.website_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
        json!({"links":links,"countries":countries,"websites":sites})
    };
    Ok(
        json!({"countries":labels(c,"countries")?,"websites":labels(c,"websites")?,"sites":labels(c,"sites")?,"links":links,"total":total,"recent":recent,"metrics":metrics}),
    )
}
pub fn save_label(c: &mut Connection, input: LabelInput) -> Result<(), String> {
    let (table, _) = table(&input.kind)?;
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err("Enter a name between 1 and 120 characters.".into());
    }
    let tx = c.transaction().map_err(err)?;
    if !input.id.is_empty() {
        let exists: bool = tx
            .query_row(
                &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"),
                [&input.id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !exists {
            return Err("This entry no longer exists. Refresh and try again.".into());
        }
    }
    let id = if input.id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        input.id
    };
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(&format!("INSERT INTO {table}(id,name,archived,created_at,updated_at) VALUES(?1,?2,?3,?4,?4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,archived=excluded.archived,updated_at=excluded.updated_at"),params![id,name,input.archived,now]).map_err(|e|if e.to_string().contains("UNIQUE"){"That name already exists. Rename or restore the saved entry.".into()}else{err(e)})?;
    tx.commit().map_err(err)
}
pub fn save_link(c: &mut Connection, input: LinkInput) -> Result<Value, String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 200 {
        return Err("Enter a link name between 1 and 200 characters.".into());
    }
    let parsed = url::Url::parse(&input.url).map_err(|_| "Use a complete HTTP or HTTPS URL.")?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || input.url.trim() != input.url
        || input.url.len() > 20000
    {
        return Err("Use a complete HTTP(S) URL without surrounding spaces.".into());
    }
    if input.country_id.is_empty() || input.website_id.is_empty() {
        return Err("Choose a country and promoting website/channel.".into());
    }
    if input.placement.len() > 2000 || input.notes.len() > 20000 {
        return Err("Placement or notes are too long.".into());
    }
    if input.site_id.as_deref() == Some("") {
        return Err("Choose a website.".into());
    }
    let tx = c.transaction().map_err(err)?;
    let existing = if input.id.is_empty() {
        None
    } else {
        Some(
            tx.query_row(
                "SELECT country_id,promoting_website_id,placement_website_id FROM managed_links WHERE id=?1",
                [&input.id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?,r.get::<_,Option<String>>(2)?)),
            )
            .map_err(|_| "This link no longer exists. Refresh and try again.")?,
        )
    };
    for (table, target, old) in [
        (
            "managed_countries",
            &input.country_id,
            existing.as_ref().map(|x| x.0.as_str()),
        ),
        (
            "promoting_websites",
            &input.website_id,
            existing.as_ref().map(|x| x.1.as_str()),
        ),
    ] {
        let archived: bool = tx
            .query_row(
                &format!("SELECT archived FROM {table} WHERE id=?1"),
                [target],
                |r| r.get(0),
            )
            .map_err(|_| "The selected country or promoting website no longer exists.")?;
        if archived && old != Some(target.as_str()) {
            return Err(
                "The selected entry is archived. Restore it before assigning new links.".into(),
            );
        }
    }
    if let Some(site) = &input.site_id {
        let archived: bool = tx
            .query_row(
                "SELECT archived FROM placement_websites WHERE id=?1",
                [site],
                |r| r.get(0),
            )
            .map_err(|_| "The selected website no longer exists.")?;
        if archived && existing.as_ref().and_then(|v| v.2.as_ref()) != Some(site) {
            return Err("The selected website is archived. Restore it first.".into());
        }
    }
    let id = if input.id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        input.id
    };
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute("INSERT INTO managed_links(id,name,country_id,promoting_website_id,placement,affiliate_url,notes,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8) ON CONFLICT(id) DO UPDATE SET name=excluded.name,country_id=excluded.country_id,promoting_website_id=excluded.promoting_website_id,placement=excluded.placement,affiliate_url=excluded.affiliate_url,notes=excluded.notes,updated_at=excluded.updated_at",params![id,name,input.country_id,input.website_id,input.placement,input.url,input.notes,now]).map_err(err)?;
    if let Some(site) = input.site_id {
        tx.execute(
            "UPDATE managed_links SET placement_website_id=?1 WHERE id=?2",
            params![site, id],
        )
        .map_err(err)?;
    }
    let saved = tx
        .query_row(&format!("{SELECT} WHERE l.id=?1"), [id], link)
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(saved)
}
#[tauri::command]
pub fn manager_snapshot(state: State<Database>, query: Query) -> Result<Value, String> {
    snapshot(&*state.connection.lock().map_err(err)?, query)
}
#[tauri::command]
pub fn manager_save_link(state: State<Database>, input: LinkInput) -> Result<Value, String> {
    save_link(&mut *state.connection.lock().map_err(err)?, input)
}
#[tauri::command]
pub fn manager_save_label(state: State<Database>, input: LabelInput) -> Result<(), String> {
    save_label(&mut *state.connection.lock().map_err(err)?, input)
}
pub fn delete_label(c: &mut Connection, kind: &str, id: &str) -> Result<(), String> {
    let (table, fk) = table(kind)?;
    let tx = c.transaction().map_err(err)?;
    let used: bool = tx.query_row(&format!("SELECT EXISTS(SELECT 1 FROM managed_links WHERE {fk}=?1)"), [id], |r| r.get(0)).map_err(err)?;
    if used { return Err("Move or delete this entry’s links first, or archive it to keep them.".into()); }
    if tx.execute(&format!("DELETE FROM {table} WHERE id=?1"), [id]).map_err(err)? == 0 { return Err("This entry no longer exists. Refresh and try again.".into()); }
    tx.commit().map_err(err)
}
#[tauri::command]
pub fn manager_delete_label(state: State<Database>, kind: String, id: String) -> Result<(), String> {
    delete_label(&mut *state.connection.lock().map_err(err)?, &kind, &id)
}
#[tauri::command]
pub fn manager_delete_link(state: State<Database>, id: String) -> Result<(), String> {
    let c = state.connection.lock().map_err(err)?;
    let n = c
        .execute("DELETE FROM managed_links WHERE id=?1", [id])
        .map_err(err)?;
    if n == 0 {
        return Err("This link was already deleted. Refresh the table.".into());
    }
    Ok(())
}
#[tauri::command]
pub fn manager_open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let u = url::Url::parse(&url).map_err(err)?;
    if !["http", "https"].contains(&u.scheme()) || u.host_str().is_none() {
        return Err("Only HTTP(S) links can be opened.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(err)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        initialize(&c).unwrap();
        c
    }
    fn label(c: &mut Connection, kind: &str, name: &str) -> String {
        save_label(
            c,
            LabelInput {
                kind: kind.into(),
                id: String::new(),
                name: name.into(),
                archived: false,
            },
        )
        .unwrap();
        labels(c, kind)
            .unwrap()
            .into_iter()
            .find(|x| x.name == name)
            .unwrap()
            .id
    }
    #[test]
    fn lifecycle_filters_and_archive() {
        let mut c = db();
        let country = label(&mut c, "countries", "India");
        let website = label(&mut c, "websites", "My channel");
        let input = LinkInput {
            site_id: None,
            id: String::new(),
            name: "My link".into(),
            country_id: country.clone(),
            website_id: website.clone(),
            placement: "IN page".into(),
            url: "https://example.invalid/?a=%2F&ref=A+B&ref=2".into(),
            notes: "Private".into(),
        };
        let saved = save_link(&mut c, input.clone()).unwrap();
        let result = snapshot(
            &c,
            Query {
                country_id: country.clone(),
                website_id: website.clone(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(result["total"], 1);
        assert_eq!(result["links"][0]["url"], input.url);
        save_label(
            &mut c,
            LabelInput {
                kind: "countries".into(),
                id: country.clone(),
                name: "India".into(),
                archived: true,
            },
        )
        .unwrap();
        assert!(save_link(&mut c, input.clone()).is_err());
        let mut editing = input;
        editing.id = saved["id"].as_str().unwrap().into();
        editing.name = "Edited while archived".into();
        save_link(&mut c, editing).unwrap();
        assert_eq!(labels(&c, "countries").unwrap()[0].link_count, 1);
        assert!(c
            .execute("DELETE FROM managed_countries WHERE id=?1", [&country])
            .is_err());
    }
    #[test]
    fn required_fields_and_duplicates() {
        let mut c = db();
        label(&mut c, "countries", "Japan");
        assert!(save_label(
            &mut c,
            LabelInput {
                kind: "countries".into(),
                id: String::new(),
                name: " japan ".into(),
                archived: false
            }
        )
        .is_err());
        let input = LinkInput {
            site_id: None,
            id: String::new(),
            name: "Invalid".into(),
            country_id: "missing".into(),
            website_id: "missing".into(),
            placement: String::new(),
            url: "javascript:alert(1)".into(),
            notes: String::new(),
        };
        assert!(save_link(&mut c, input).is_err());
        assert_eq!(
            snapshot(&c, Query::default()).unwrap()["metrics"]["links"],
            0
        );
    }
    #[test]
    fn search_literal_and_combined_filters() {
        let mut c = db();
        let a = label(&mut c, "countries", "A");
        let b = label(&mut c, "countries", "B");
        let w = label(&mut c, "websites", "W");
        for (country, name) in [(&a, "100% link"), (&b, "Other link")] {
            save_link(
                &mut c,
                LinkInput {
                    site_id: None,
                    id: String::new(),
                    name: name.into(),
                    country_id: country.clone(),
                    website_id: w.clone(),
                    placement: String::new(),
                    url: "https://example.invalid".into(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }
        assert_eq!(
            snapshot(
                &c,
                Query {
                    search: "%".into(),
                    ..Default::default()
                }
            )
            .unwrap()["total"],
            1
        );
        assert_eq!(
            snapshot(
                &c,
                Query {
                    country_id: a,
                    website_id: w,
                    ..Default::default()
                }
            )
            .unwrap()["total"],
            1
        );
    }
}
