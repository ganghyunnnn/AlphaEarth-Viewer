"""줌/팬 시 '빵꾸(빈 타일)' 재현 — 미완료/204 요청을 추적."""
import time, urllib.parse as up
from collections import Counter
from playwright.sync_api import sync_playwright

URL = "http://localhost:8080/?zoom=12"


def main():
    reqs = {}   # url -> start time (미완료 추적)
    done = {}   # url -> status
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1100, "height": 800})

        def on_req(r):
            if "/api/mosaic/tiles" in r.url:
                reqs[r.url] = time.time()
        def on_resp(r):
            if "/api/mosaic/tiles" in r.url:
                done[r.url] = r.status
        def on_fail(r):
            if "/api/mosaic/tiles" in r.url:
                done[r.url] = "FAILED:" + (r.failure or "?")
        pg.on("request", on_req)
        pg.on("response", on_resp)
        pg.on("requestfailed", on_fail)

        pg.goto(URL, wait_until="domcontentloaded")
        pg.wait_for_timeout(8000)  # 초기 로드
        cx, cy = 550, 400

        def zoom(delta):
            pg.mouse.move(cx, cy)
            pg.mouse.wheel(0, delta)
        def pan(dx, dy):
            pg.mouse.move(cx, cy)
            pg.mouse.down()
            pg.mouse.move(cx - dx, cy - dy, steps=12)
            pg.mouse.up()

        for name, fn in [
            ("zoom+", lambda: zoom(-400)),
            ("pan",   lambda: pan(300, 200)),
            ("zoom-", lambda: zoom(400)),
            ("pan2",  lambda: pan(-250, 300)),
            ("zoom+2", lambda: zoom(-400)),
            ("pan3",  lambda: pan(400, -150)),
        ]:
            fn()
            pg.wait_for_timeout(6000)

        pg.wait_for_timeout(4000)
        pg.screenshot(path="/tmp/holes.png")
        b.close()

    # 미완료 = 요청됐으나 응답/실패 기록 없음
    pending = [u for u in reqs if u not in done]
    statuses = Counter(v for v in done.values())
    n204 = sum(1 for v in done.values() if v == 204)
    print(f"총 타일 요청: {len(reqs)}")
    print(f"응답 상태 분포: {dict(statuses)}")
    print(f"204(빈 타일): {n204}")
    print(f"미완료(요청만, 응답 없음): {len(pending)}")
    for u in pending[:8]:
        q = up.parse_qs(up.urlparse(u).query)
        path = up.urlparse(u).path
        print(f"   PENDING {path} bidx={q.get('bidx')}")
    print("스크린샷: /tmp/holes.png")


if __name__ == "__main__":
    main()
