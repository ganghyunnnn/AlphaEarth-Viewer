"""유휴 예측 프리페치 검증.

1) 초기 로드 후 유휴 시 스크럽 이웃(±1) 프레임 타일이 미리 요청되는지
2) 이후 ArrowRight(스크럽 +1) 시 그 타일들이 캐시 HIT으로 빨라지는지
"""
import time
import urllib.parse as up
from collections import Counter, defaultdict
from playwright.sync_api import sync_playwright

# 깔끔한 격리: 캐시에 없는 새 프레임 + 네트워크 정적 감지로 단계 구분
URL = "http://localhost:8080/?zoom=10&scrub=98765"


def bidx_of(url):
    q = up.parse_qs(up.urlparse(url).query)
    return tuple(q.get("bidx", []))


def main():
    events = []  # (t, phase, bidx, status, xcache)
    by_phase = defaultdict(list)  # phase -> [url]
    phase = {"v": "init"}
    t0 = time.time()

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1100, "height": 800})

        def on_resp(r):
            if "/api/mosaic/tiles" in r.url:
                xc = r.headers.get("x-cache", "?")
                events.append((time.time() - t0, phase["v"], bidx_of(r.url), r.status, xc))
                by_phase[phase["v"]].append(r.url)

        last_req = {"t": time.time()}
        pg.on("request", lambda r: last_req.__setitem__("t", time.time())
              if "/api/mosaic/tiles" in r.url else None)
        pg.on("response", on_resp)
        pg.goto(URL, wait_until="domcontentloaded")

        # 초기 콜드 로드가 끝날 때까지(=3s간 새 타일 요청 없음) 대기 → map idle 발화 시점
        deadline = time.time() + 45
        while time.time() < deadline:
            pg.wait_for_timeout(500)
            if time.time() - last_req["t"] > 3.0:
                break
        init_done = time.time() - t0
        print(f"[초기 로드 완료(정적)까지: {init_done:.1f}s]")
        phase["v"] = "idle"  # 이 시점부터 = 프리페치(유휴)
        pg.wait_for_timeout(14000)  # 프리페치가 이웃 프레임을 당겨올 시간

        # 현재 프레임 bidx(가장 많이 init에서 등장) 파악
        init_bidx = Counter(e[2] for e in events if e[1] == "init")
        cur = init_bidx.most_common(1)[0][0] if init_bidx else None

        # 스크럽 +1 (ArrowRight) — 캔버스에 포커스 후 키
        phase["v"] = "scrub"
        scrub_start = time.time() - t0
        pg.keyboard.press("ArrowRight")
        pg.wait_for_timeout(6000)
        b.close()

    # 분석 — URL 키(z/x/y + bidx) 집합 비교
    def key(u):
        pu = up.urlparse(u)
        q = up.parse_qs(pu.query)
        return (pu.path, tuple(q.get("bidx", [])))

    idle_keys = {key(u) for u in by_phase["idle"]}
    scrub_urls = by_phase["scrub"]
    scrub_keys = {key(u) for u in scrub_urls}
    overlap = scrub_keys & idle_keys

    idle_z = Counter(up.urlparse(u).path.split("/")[-3] for u in by_phase["idle"])
    scrub_z = Counter(up.urlparse(u).path.split("/")[-3] for u in scrub_urls)
    idle_bx = Counter(key(u)[1] for u in by_phase["idle"])
    scrub_bx = Counter(key(u)[1] for u in scrub_urls)

    print(f"\n[유휴(프리페치)] {len(by_phase['idle'])}건  z분포={dict(idle_z)}")
    for bx, c in idle_bx.most_common():
        print(f"   bidx={bx} x{c}")
    print(f"\n[스크럽 +1] {len(scrub_urls)}건  z분포={dict(scrub_z)}  (t={scrub_start:.1f}s)")
    for bx, c in scrub_bx.most_common():
        print(f"   bidx={bx} x{c}")

    scrub = [e for e in events if e[1] == "scrub"]
    hit = sum(1 for e in scrub if e[4] in ("HIT", "FOLLOW"))
    print(f"\n   캐시 HIT/FOLLOW: {hit}/{len(scrub)}")
    print(f"   프리페치 URL ∩ 스크럽 URL: {len(overlap)}/{len(scrub_keys)}")
    if scrub:
        print(f"   스크럽 후 마지막 응답까지: {max(e[0] for e in scrub) - scrub_start:.2f}s")
    # 불일치 진단: 각 집합 샘플
    if len(overlap) == 0:
        si = next(iter(scrub_keys), None)
        ii = next(iter(idle_keys), None)
        print(f"   ⚠ 불일치  scrub예={si}\n             idle예={ii}")


if __name__ == "__main__":
    main()
