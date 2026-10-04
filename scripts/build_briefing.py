"""Builds the daily briefing.

Reads sources.json, fetches every RSS/Atom feed, picks the freshest articles
for each topic (with images where possible) and writes site/data/briefing.json,
which the app reads. Runs every morning on GitHub Actions.
"""

from __future__ import annotations

import html
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import feedparser
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources.json"
OUTPUT = ROOT / "site" / "data" / "briefing.json"

USER_AGENT = (
    "Mozilla/5.0 (compatible; DailyBriefingBot/1.0; "
    "+https://github.com/lawgirl-london/daily-briefing)"
)
MAX_AGE_DAYS = 7          # ignore anything older than this (when a date is known)
PER_TOPIC = 14            # articles kept per tab
PER_SOURCE = 6            # so no single publisher dominates a tab
SUMMARY_CHARS = 420

session = requests.Session()
session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "en-GB,en;q=0.9"})


# ---------------------------------------------------------------- helpers

def clean_text(raw: str | None) -> str:
    if not raw:
        return ""
    text = BeautifulSoup(raw, "html.parser").get_text(" ", strip=True)
    text = html.unescape(re.sub(r"\s+", " ", text)).strip()
    # Drop boilerplate many feeds append
    text = re.sub(r"(The post .*? appeared first on .*?\.?$)", "", text).strip()
    text = re.sub(r"\s*(Continue reading|Read more)\.*\s*$", "", text, flags=re.I)
    if len(text) > SUMMARY_CHARS:
        cut = text[:SUMMARY_CHARS].rsplit(" ", 1)[0]
        text = cut.rstrip(",;:") + "…"
    return text


def upgrade_image(url: str) -> str:
    """Ask for bigger versions of known thumbnail formats."""
    # BBC: https://ichef.bbci.co.uk/ace/standard/240/... -> 800 wide
    url = re.sub(r"(ichef\.bbci\.co\.uk/(?:ace/standard|news))/\d+/", r"\1/800/", url)
    return url


def is_image_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return not path.endswith((".mp3", ".mp4", ".m4a", ".pdf"))


def image_from_entry(entry) -> str | None:
    candidates: list[tuple[int, str]] = []

    for media in entry.get("media_content", []) or []:
        url = media.get("url")
        if not url or media.get("medium") in ("video", "audio"):
            continue
        mtype = media.get("type", "")
        if mtype and not mtype.startswith("image"):
            continue
        width = int(media.get("width") or 0)
        candidates.append((width or 500, url))

    for thumb in entry.get("media_thumbnail", []) or []:
        if thumb.get("url"):
            candidates.append((int(thumb.get("width") or 300), thumb["url"]))

    for link in entry.get("links", []) or []:
        if link.get("rel") == "enclosure" and str(link.get("type", "")).startswith("image"):
            candidates.append((600, link.get("href")))

    for enc in entry.get("enclosures", []) or []:
        if str(enc.get("type", "")).startswith("image") and enc.get("href"):
            candidates.append((600, enc["href"]))

    if not candidates:
        blobs = [entry.get("summary", "")]
        blobs += [c.get("value", "") for c in entry.get("content", []) or []]
        for blob in blobs:
            match = re.search(r"<img[^>]+src=[\"']([^\"']+)", blob or "")
            if match and "feeds.feedburner" not in match.group(1):
                candidates.append((400, match.group(1)))
                break

    candidates = [(w, u) for w, u in candidates if u and is_image_url(u)]
    if not candidates:
        return None
    best = max(candidates, key=lambda c: c[0])[1]
    return upgrade_image(html.unescape(best))


def entry_date(entry) -> datetime | None:
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        parsed = entry.get(key)
        if parsed:
            try:
                return datetime(*parsed[:6], tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
    return None


def norm_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


# ---------------------------------------------------------------- fetching

def fetch_feed(feed: dict) -> tuple[dict, list[dict]]:
    try:
        resp = session.get(feed["url"], timeout=25)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"  ! {feed['name']}: {exc}", file=sys.stderr)
        return feed, []

    parsed = feedparser.parse(resp.content)
    articles = []
    for entry in parsed.entries[:40]:
        title = clean_text(entry.get("title"))
        link = entry.get("link")
        if not title or not link:
            continue
        summary_raw = entry.get("summary") or ""
        if not summary_raw and entry.get("content"):
            summary_raw = entry["content"][0].get("value", "")
        date = entry_date(entry)
        articles.append({
            "title": title,
            "url": link,
            "summary": clean_text(summary_raw),
            "source": feed["name"],
            "published": date.isoformat() if date else None,
            "image": image_from_entry(entry),
        })
    print(f"  ✓ {feed['name']}: {len(articles)} items")
    return feed, articles


def fetch_og_image(url: str) -> str | None:
    """Look up an article's share image when the feed didn't include one."""
    try:
        resp = session.get(url, timeout=12)
        resp.raise_for_status()
    except requests.RequestException:
        return None
    soup = BeautifulSoup(resp.text[:300_000], "html.parser")
    for attrs in (
        {"property": "og:image"},
        {"name": "og:image"},
        {"name": "twitter:image"},
        {"property": "twitter:image"},
    ):
        tag = soup.find("meta", attrs=attrs)
        if tag and tag.get("content"):
            return upgrade_image(urljoin(url, tag["content"].strip()))
    return None


def select_articles(articles: list[dict], now: datetime) -> list[dict]:
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    seen_urls, seen_titles = set(), set()
    fresh = []
    for art in articles:
        key_t = norm_title(art["title"])
        if art["url"] in seen_urls or key_t in seen_titles:
            continue
        if art["published"] and datetime.fromisoformat(art["published"]) < cutoff:
            continue
        seen_urls.add(art["url"])
        seen_titles.add(key_t)
        fresh.append(art)

    fresh.sort(key=lambda a: a["published"] or "", reverse=True)

    per_source: dict[str, int] = {}
    chosen = []
    for art in fresh:
        if per_source.get(art["source"], 0) >= PER_SOURCE:
            continue
        per_source[art["source"]] = per_source.get(art["source"], 0) + 1
        chosen.append(art)
        if len(chosen) >= PER_TOPIC:
            break
    return chosen


def load_previous() -> dict:
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


# ---------------------------------------------------------------- main

def build() -> dict:
    config = json.loads(SOURCES.read_text(encoding="utf-8"))
    previous = {t["id"]: t for t in load_previous().get("topics", [])}
    now = datetime.now(timezone.utc)

    topics_out = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for topic in config["topics"]:
            print(f"{topic['name']}")
            results = list(pool.map(fetch_feed, topic["feeds"]))
            articles = select_articles([a for _, r in results for a in r], now)

            if not articles and topic["id"] in previous:
                print("  ↺ no fresh articles, keeping yesterday's", file=sys.stderr)
                articles = previous[topic["id"]].get("articles", [])

            missing = [a for a in articles if not a.get("image")]
            for art, img in zip(missing, pool.map(lambda a: fetch_og_image(a["url"]), missing)):
                art["image"] = img

            for art in articles:
                art["topic"] = topic["id"]

            # Every publisher behind this tab, so the app can show where news comes from
            sources, seen = [], set()
            for feed, items in results:
                home = "{0.scheme}://{0.netloc}".format(urlparse(feed["url"]))
                if feed["name"] in seen:
                    if items:  # a second feed from the same publisher worked
                        next(x for x in sources if x["name"] == feed["name"])["working"] = True
                    continue
                seen.add(feed["name"])
                sources.append({
                    "name": feed["name"],
                    "about": feed.get("about", ""),
                    "home": feed.get("home") or home,
                    "working": bool(items),
                })

            topics_out.append({
                "id": topic["id"],
                "name": topic["name"],
                "icon": topic["icon"],
                "color": topic["color"],
                "articles": articles,
                "sources": sources,
            })

    # Highlights: the freshest story from each topic, preferring ones with a picture
    highlights = []
    for topic in topics_out:
        pick = next((a for a in topic["articles"] if a.get("image")), None)
        pick = pick or (topic["articles"][0] if topic["articles"] else None)
        if pick:
            highlights.append(pick["url"])

    return {
        "generated_at": now.isoformat(),
        "highlights": highlights,
        "topics": topics_out,
    }


def main() -> None:
    data = build()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(len(t["articles"]) for t in data["topics"])
    print(f"\nWrote {total} articles across {len(data['topics'])} topics to {OUTPUT}")
    if total == 0:
        sys.exit("No articles at all — every feed failed. Not publishing an empty briefing.")


if __name__ == "__main__":
    main()
