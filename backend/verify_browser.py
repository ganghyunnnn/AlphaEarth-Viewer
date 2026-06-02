"""Playwright 헤드리스 브라우저로 프론트엔드 엔드투엔드 검증.

- 페이지 로드 → MapLibre 캔버스 + AEF 모자이크 타일 렌더 확인
- 스크럽 바 변경 시 밴드 칩 갱신 + 새 bidx 타일 요청 발생 확인
- 스크린샷 저장
실행: backend/.venv 로 `python verify_browser.py`  (vite 5173, 백엔드 8000 구동 상태)
"""

import sys
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/?zoom=12"  # 프리워밍한 z12 서울 뷰
OUT1 = "../verification_render.png"
OUT2 = "../verification_scrub.png"


def main() -> int:
    tile_status = []  # (status, bidx_tuple)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1000, "height": 700})

        tile_requests = []  # bidx 튜플 (요청 시점)

        def on_response(resp):
            if "/api/mosaic/tiles" in resp.url:
                import urllib.parse as up

                q = up.parse_qs(up.urlparse(resp.url).query)
                tile_status.append((resp.status, tuple(q.get("bidx", []))))

        def on_request(req):
            if "/api/mosaic/tiles" in req.url:
                import urllib.parse as up

                q = up.parse_qs(up.urlparse(req.url).query)
                tile_requests.append(tuple(q.get("bidx", [])))

        page.on("response", on_response)
        page.on("request", on_request)

        page.goto(URL, wait_until="domcontentloaded")

        # 타일 200 응답을 최대 60s 대기
        deadline = time.time() + 60
        while time.time() < deadline:
            if sum(1 for s, _ in tile_status if s == 200) >= 3:
                break
            page.wait_for_timeout(500)
        page.wait_for_timeout(1500)  # 래스터 페인트 안정화

        canvas = page.query_selector("#map canvas.maplibregl-canvas") or page.query_selector("canvas")
        n200 = sum(1 for s, _ in tile_status if s == 200)
        bidx_before = page.text_content("#chipR"), page.text_content("#chipG"), page.text_content("#chipB")
        page.screenshot(path=OUT1)

        # --- 스크럽 변경 검증 (콜드 응답은 느리므로 '요청' 발생으로 판정) ---
        before_count = len(tile_requests)
        page.eval_on_selector(
            "#scrub",
            "el => { el.value = '100000'; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }",
        )
        page.wait_for_timeout(2500)
        bidx_after = page.text_content("#chipR"), page.text_content("#chipG"), page.text_content("#chipB")
        new_reqs = tile_requests[before_count:]
        page.screenshot(path=OUT2)

        browser.close()

    print("== 검증 결과 ==")
    print(f"  canvas 존재: {canvas is not None}")
    print(f"  타일 200 응답 수: {n200}  (총 {len(tile_status)} 요청)")
    print(f"  밴드 칩(스크럽 전): {bidx_before}")
    print(f"  밴드 칩(스크럽 후): {bidx_after}")
    print(f"  스크럽 후 새 타일 요청: {len(new_reqs)}개, 예: {new_reqs[:2]}")
    print(f"  스크린샷: {OUT1}, {OUT2}")

    # 스크럽 후 요청들이 이전과 다른 bidx를 갖는지
    changed_bidx = any(b not in (tuple(),) and b != tile_requests[0] for b in new_reqs) if tile_requests else False
    ok = (
        canvas is not None
        and n200 >= 1
        and bidx_before != bidx_after  # 칩이 갱신됨
        and len(new_reqs) >= 1  # 새 조합으로 타일 재요청 발생
        and changed_bidx
    )
    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
