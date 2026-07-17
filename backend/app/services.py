from __future__ import annotations

import csv
import io
import re
from typing import Iterable

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session, joinedload

from .models import Entry, EntryLink
from .schemas import EntryDetail, EntryPayload, EntryRef, SearchResult, UnresolvedLink


class EntryConflictError(Exception):
    pass


class EntryImportError(Exception):
    pass


CSV_HEADERS = (
    "id",
    "spelling",
    "language",
    "meaning",
    "aliases_raw",
    "upstream_raw",
)


def split_csv_text(raw: str) -> list[str]:
    normalized = raw.replace("\n", ",")
    return [part.strip() for part in normalized.split(",") if part.strip()]


def normalize_language(value: str) -> str:
    return " ".join(value.strip().casefold().split())


def normalize_label(value: str) -> str:
    return re.sub(r"[\s\-]+", " ", value.strip().casefold()).strip()


def parse_link_label(raw: str) -> tuple[str, str | None]:
    match = re.fullmatch(r"(.+?)\s*\[([^\[\]]+)\]\s*", raw.strip())
    if match is None:
        return raw.strip(), None
    return match.group(1).strip(), normalize_language(match.group(2)) or None


def entry_language(entry: Entry) -> str:
    return normalize_language(entry.language)


def entry_identifiers(entry: Entry) -> set[str]:
    identifiers = {normalize_label(entry.spelling)}
    identifiers.update(normalize_label(alias) for alias in split_csv_text(entry.aliases_raw))
    return {item for item in identifiers if item}


def describe_entry(entry: Entry) -> str:
    if entry.language.strip():
        return f"{entry.spelling} [{entry.language}]"
    return entry.spelling


def payload_identifiers(payload: EntryPayload) -> set[str]:
    identifiers = {normalize_label(payload.spelling)}
    identifiers.update(normalize_label(alias) for alias in split_csv_text(payload.aliases_raw))
    return {item for item in identifiers if item}


def find_matching_entries(
    entries: Iterable[Entry],
    label: str,
    source_entry_id: int | None = None,
) -> list[Entry]:
    spelling_label, language_label = parse_link_label(label)
    normalized = normalize_label(spelling_label)
    if not normalized:
        return []

    matches: list[Entry] = []
    for entry in entries:
        if source_entry_id is not None and entry.id == source_entry_id:
            continue
        if normalized not in entry_identifiers(entry):
            continue
        if language_label is not None and entry_language(entry) != language_label:
            continue
        matches.append(entry)
    return matches


def validate_upstream_conflicts(
    session: Session,
    payload: EntryPayload,
    current_entry_id: int | None = None,
) -> None:
    entries = load_all_entries(session)
    self_identifiers = payload_identifiers(payload)
    normalized_language = normalize_language(payload.language)

    for label in split_csv_text(payload.upstream_raw):
        spelling_label, language_label = parse_link_label(label)
        normalized_label = normalize_label(spelling_label)
        if not normalized_label:
            continue

        if normalized_label in self_identifiers and (language_label is None or language_label == normalized_language):
            raise EntryConflictError(
                f"上游关联“{label}”与当前词条自身重叠，不能将词条设置为自己的上游。"
            )

        matches = find_matching_entries(entries, label, source_entry_id=current_entry_id)
        if language_label is None and len(matches) > 1:
            languages = sorted({entry.language.strip() or "未标注" for entry in matches})
            raise EntryConflictError(
                f"上游关联“{label}”匹配到多个语言归属（{'、'.join(languages)}），无法成功设置；"
                "请改用“spelling [语言]”格式。"
            )


def validate_upstream_conflicts_for_entries(entries: Iterable[Entry]) -> None:
    all_entries = list(entries)

    for entry in all_entries:
        self_identifiers = entry_identifiers(entry)
        normalized_language = entry_language(entry)

        for label in split_csv_text(entry.upstream_raw):
            spelling_label, language_label = parse_link_label(label)
            normalized_label = normalize_label(spelling_label)
            if not normalized_label:
                continue

            if normalized_label in self_identifiers and (
                language_label is None or language_label == normalized_language
            ):
                raise EntryConflictError(
                    f"上游关联“{label}”与词条“{describe_entry(entry)}”自身重叠，不能将词条设置为自己的上游。"
                )

            matches = find_matching_entries(all_entries, label, source_entry_id=entry.id)
            if language_label is None and len(matches) > 1:
                languages = sorted({match.language.strip() or "未标注" for match in matches})
                raise EntryConflictError(
                    f"词条“{describe_entry(entry)}”的上游关联“{label}”匹配到多个语言归属（{'、'.join(languages)}），"
                    "无法成功导入；请改用“spelling [语言]”格式。"
                )


def validate_entry_conflicts(
    session: Session,
    payload: EntryPayload,
    current_entry_id: int | None = None,
) -> None:
    normalized_language = normalize_language(payload.language)
    spelling = payload.spelling.strip()
    normalized_spelling = normalize_label(spelling)
    aliases = split_csv_text(payload.aliases_raw)

    candidates: list[tuple[str, str, str]] = [("拼写", spelling, normalized_spelling)]
    candidates.extend(("别名", alias, normalize_label(alias)) for alias in aliases)

    seen_identifiers: dict[str, tuple[str, str]] = {}
    for field_name, raw_value, normalized_value in candidates:
        if not normalized_value:
            continue

        existing = seen_identifiers.get(normalized_value)
        if existing is not None:
            raise EntryConflictError(
                f"当前词条内存在冲突：{field_name}“{raw_value}”与{existing[0]}“{existing[1]}”在语言归属"
                f"“{payload.language.strip() or '未标注'}”下重复。"
            )

        seen_identifiers[normalized_value] = (field_name, raw_value)

    entries = load_all_entries(session)
    for entry in entries:
        if current_entry_id is not None and entry.id == current_entry_id:
            continue
        if entry_language(entry) != normalized_language:
            continue

        existing_identifiers = entry_identifiers(entry)
        for field_name, raw_value, normalized_value in candidates:
            if not normalized_value or normalized_value not in existing_identifiers:
                continue

            raise EntryConflictError(
                f"{field_name}“{raw_value}”与现有词条“{describe_entry(entry)}”冲突：同一语言归属下，"
                "拼写和所有别名的组合必须唯一。"
            )

    validate_upstream_conflicts(session, payload, current_entry_id=current_entry_id)


def load_all_entries(session: Session) -> list[Entry]:
    return list(session.scalars(select(Entry)).all())


def resolve_target(entries: Iterable[Entry], label: str, source_entry_id: int | None = None) -> Entry | None:
    spelling_label, language_label = parse_link_label(label)
    matches = find_matching_entries(entries, label, source_entry_id=source_entry_id)
    if not matches:
        return None
    if language_label is None and len(matches) > 1:
        return None
    return matches[0]


def rebuild_outgoing_links(session: Session, entry: Entry) -> None:
    entries = load_all_entries(session)
    session.query(EntryLink).filter(EntryLink.source_entry_id == entry.id).delete()

    for label in split_csv_text(entry.upstream_raw):
        target = resolve_target(entries, label, source_entry_id=entry.id)
        session.add(
            EntryLink(
                source_entry_id=entry.id,
                target_entry_id=target.id if target else None,
                raw_label=label,
                resolved=1 if target else 0,
            )
        )


def rebuild_all_links(session: Session) -> None:
    entries = load_all_entries(session)
    session.query(EntryLink).delete()

    for entry in entries:
        for label in split_csv_text(entry.upstream_raw):
            target = resolve_target(entries, label, source_entry_id=entry.id)
            session.add(
                EntryLink(
                    source_entry_id=entry.id,
                    target_entry_id=target.id if target else None,
                    raw_label=label,
                    resolved=1 if target else 0,
                )
            )


def resolve_links_for_entry(session: Session, entry: Entry) -> None:
    entries = load_all_entries(session)
    unresolved_links = session.scalars(
        select(EntryLink)
        .where(EntryLink.resolved == 0)
        .options(joinedload(EntryLink.source_entry))
    ).all()

    for link in unresolved_links:
        target = resolve_target(entries, link.raw_label, source_entry_id=link.source_entry_id)
        if target is None:
            continue
        link.target_entry_id = target.id
        link.resolved = 1


def break_links_to_entry(session: Session, entry: Entry) -> None:
    incoming_links = session.scalars(
        select(EntryLink).where(EntryLink.target_entry_id == entry.id)
    ).all()
    for link in incoming_links:
        link.target_entry_id = None
        link.resolved = 0


def search_entries(session: Session, query: str) -> list[SearchResult]:
    trimmed = query.strip()
    if not trimmed:
        return []

    pattern = f"%{trimmed}%"
    statement: Select[tuple[Entry]] = (
        select(Entry)
        .where(
            or_(
                Entry.spelling.ilike(pattern),
                Entry.language.ilike(pattern),
                Entry.meaning.ilike(pattern),
                Entry.aliases_raw.ilike(pattern),
            )
        )
        .order_by(Entry.spelling.asc())
        .limit(12)
    )
    entries = session.scalars(statement).all()
    return [
        SearchResult(
            id=entry.id,
            spelling=entry.spelling,
            language=entry.language,
            aliases=split_csv_text(entry.aliases_raw),
            meaning_preview=entry.meaning[:120],
        )
        for entry in entries
    ]


def serialize_entry(session: Session, entry_id: int) -> EntryDetail | None:
    entry = session.get(Entry, entry_id)
    if entry is None:
        return None

    upstream_links = session.scalars(
        select(EntryLink)
        .where(EntryLink.source_entry_id == entry.id)
        .options(joinedload(EntryLink.target_entry))
        .order_by(EntryLink.id.asc())
    ).all()
    downstream_links = session.scalars(
        select(EntryLink)
        .where(EntryLink.target_entry_id == entry.id, EntryLink.resolved == 1)
        .options(joinedload(EntryLink.source_entry))
        .order_by(EntryLink.id.asc())
    ).all()

    upstream_resolved = [
        EntryRef(
            id=link.target_entry.id,
            spelling=link.target_entry.spelling,
            language=link.target_entry.language,
        )
        for link in upstream_links
        if link.target_entry is not None and link.resolved
    ]
    upstream_unresolved = [
        UnresolvedLink(label=link.raw_label)
        for link in upstream_links
        if link.target_entry is None or not link.resolved
    ]
    downstream = [
        EntryRef(
            id=link.source_entry.id,
            spelling=link.source_entry.spelling,
            language=link.source_entry.language,
        )
        for link in downstream_links
        if link.source_entry is not None
    ]

    seen_downstream: set[int] = set()
    unique_downstream: list[EntryRef] = []
    for ref in downstream:
        if ref.id in seen_downstream:
            continue
        seen_downstream.add(ref.id)
        unique_downstream.append(ref)

    return EntryDetail(
        id=entry.id,
        spelling=entry.spelling,
        language=entry.language,
        meaning=entry.meaning,
        aliases_raw=entry.aliases_raw,
        aliases=split_csv_text(entry.aliases_raw),
        upstream_raw=entry.upstream_raw,
        upstream_resolved=upstream_resolved,
        upstream_unresolved=upstream_unresolved,
        downstream=unique_downstream,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


def create_entry(session: Session, payload: EntryPayload) -> Entry:
    validate_entry_conflicts(session, payload)
    entry = Entry(
        spelling=payload.spelling.strip(),
        language=payload.language.strip(),
        meaning=payload.meaning.strip(),
        aliases_raw=payload.aliases_raw.strip(),
        upstream_raw=payload.upstream_raw.strip(),
    )
    session.add(entry)
    session.flush()
    rebuild_outgoing_links(session, entry)
    session.flush()
    resolve_links_for_entry(session, entry)
    session.commit()
    session.refresh(entry)
    return entry


def update_entry(session: Session, entry: Entry, payload: EntryPayload) -> Entry:
    validate_entry_conflicts(session, payload, current_entry_id=entry.id)
    entry.spelling = payload.spelling.strip()
    entry.language = payload.language.strip()
    entry.meaning = payload.meaning.strip()
    entry.aliases_raw = payload.aliases_raw.strip()
    entry.upstream_raw = payload.upstream_raw.strip()
    session.flush()
    break_links_to_entry(session, entry)
    rebuild_outgoing_links(session, entry)
    session.flush()

    entries = load_all_entries(session)
    unresolved = session.scalars(select(EntryLink).where(EntryLink.resolved == 0)).all()
    for link in unresolved:
        target = resolve_target(entries, link.raw_label, source_entry_id=link.source_entry_id)
        if target is not None:
            link.target_entry_id = target.id
            link.resolved = 1

    session.commit()
    session.refresh(entry)
    return entry


def serialize_entries_csv(session: Session) -> str:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CSV_HEADERS)
    writer.writeheader()

    entries = session.scalars(select(Entry).order_by(Entry.id.asc())).all()
    for entry in entries:
        writer.writerow(
            {
                "id": entry.id,
                "spelling": entry.spelling,
                "language": entry.language,
                "meaning": entry.meaning,
                "aliases_raw": entry.aliases_raw,
                "upstream_raw": entry.upstream_raw,
            }
        )

    return output.getvalue()


def parse_optional_int(raw_value: str | None, row_number: int, field_name: str) -> int | None:
    value = (raw_value or "").strip()
    if not value:
        return None

    try:
        parsed = int(value)
    except ValueError as exc:
        raise EntryImportError(f"第 {row_number} 行的 {field_name} 不是有效整数。") from exc

    if parsed <= 0:
        raise EntryImportError(f"第 {row_number} 行的 {field_name} 必须大于 0。")

    return parsed


def import_entries_csv(session: Session, csv_text: str) -> int:
    reader = csv.DictReader(io.StringIO(csv_text, newline=""))
    if reader.fieldnames is None:
        raise EntryImportError("CSV 缺少表头。")

    missing_headers = [header for header in CSV_HEADERS if header not in reader.fieldnames]
    if missing_headers:
        raise EntryImportError(f"CSV 缺少列：{'、'.join(missing_headers)}。")

    imported_rows: list[tuple[int | None, EntryPayload]] = []
    seen_ids: set[int] = set()
    for row_number, row in enumerate(reader, start=2):
        if not any((value or "").strip() for value in row.values()):
            continue

        entry_id = parse_optional_int(row.get("id"), row_number, "id")
        if entry_id is not None and entry_id in seen_ids:
            raise EntryImportError(f"第 {row_number} 行的 id 与前文重复。")
        if entry_id is not None:
            seen_ids.add(entry_id)

        try:
            payload = EntryPayload(
                spelling=(row.get("spelling") or "").strip(),
                language=(row.get("language") or "").strip(),
                meaning=(row.get("meaning") or "").strip(),
                aliases_raw=(row.get("aliases_raw") or "").strip(),
                upstream_raw=(row.get("upstream_raw") or "").strip(),
            )
        except Exception as exc:
            raise EntryImportError(f"第 {row_number} 行的数据不合法：{exc}") from exc

        imported_rows.append((entry_id, payload))

    session.query(EntryLink).delete()
    session.query(Entry).delete()
    session.flush()

    for entry_id, payload in imported_rows:
        validate_entry_conflicts(session, payload)
        entry = Entry(
            id=entry_id,
            spelling=payload.spelling.strip(),
            language=payload.language.strip(),
            meaning=payload.meaning.strip(),
            aliases_raw=payload.aliases_raw.strip(),
            upstream_raw=payload.upstream_raw.strip(),
        )
        session.add(entry)
        session.flush()

    validate_upstream_conflicts_for_entries(load_all_entries(session))
    rebuild_all_links(session)
    session.commit()
    return len(imported_rows)
