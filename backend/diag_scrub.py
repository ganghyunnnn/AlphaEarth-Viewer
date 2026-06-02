"""스크럽 시 타일 재요청이 실제로 나가는지 진단 (Docker 8080 대상)."""
import time
import urllib.parse as up
from playwright.sync_api import sync_playwright

URL = "http://localhost:8080/?zoom=12"


def bidx_of(u):
    q = up.parse_qs(up.urlparse(u).query)
    return tuple(q.get("bidx", []))


def main():
    reqs, resps, console_errs, page_errs = [], [], [], []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1000, "height": 700})
        page.on("request", lambda r: reqs.append((time.time(), bidx_of(r.url))) if "/api/mosaic/tiles" in r.url else None)
        page.on("response", lambda r: resps.append((r.status, bidx_of(r.url))) if "/api/mosaic/tiles" in r.url else None)
        page.on("console", lambda m: console_errs.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errs.append(str(e)))

        page.goto(URL, wait_until="domcontentloaded")
        # 초기 렌더 대기
        deadline = time.time() + 60
        while time.time() < deadline:
            if sum(1 for s, _ in resps if s == 200) >= 1:
                break
            page.wait_for_timeout(500)
        page.wait_for_timeout(1500)

        init_count = len(reqs)
        chip_before = (page.text_content("#chipR"), page.text_content("#chipG"), page.text_content("#chipB"))

        # --- 실제 드래그 시뮬레이션: 인접 프레임 여러 단계 input 후 change ---
        base = int(page.eval_on_selector("#scrub", "el => Number(el.value)"))
        seq = [base + 1, base + 2, base + 3, base + 5, base + 8]
        for v in seq:
            page.eval_on_selector("#scrub", f"el => {{ el.value='{v}'; el.dispatchEvent(new Event('input',{{bubbles:true}})); }}")
            page.wait_for_timeout(60)
        # 손 뗌 (commit)
        page.eval_on_selector("#scrub", f"el => {{ el.value='{seq[-1]}'; el.dispatchEvent(new Event('change',{{bubbles:true}})); }}")
        resp_mark = len(resps)
        page.wait_for_timeout(50000)  # 콜드 렌더 완료까지 대기

        chip_after = (page.text_content("#chipR"), page.text_content("#chipG"), page.text_content("#chipB"))
        new_reqs = reqs[init_count:]
        new_resps = resps[resp_mark:]
        browser.close()

    print("== 진단 ==")
    print(f"초기 mosaic 요청 수: {init_count}")
    print(f"칩 전: {chip_before}")
    print(f"칩 후: {chip_after}  (바뀜: {chip_before != chip_after})")
    print(f"스크럽 후 새 mosaic 요청: {len(new_reqs)}개")
    for t, b in new_reqs[:10]:
        print(f"   bidx={b}")
    from collections import Counter
    print(f"스크럽 후 응답 상태 분포: {dict(Counter(s for s, _ in new_resps))}")
    print(f"콘솔 에러 수: {len(console_errs)}  예: {console_errs[:3]}")
    print(f"페이지 에러: {page_errs[:3]}")
    n504 = sum(1 for s, _ in new_resps if s == 504)
    n200 = sum(1 for s, _ in new_resps if s == 200)
    print(f"\n판정: 504={n504}, 200={n200} → {'504 해결, 타일 렌더 정상' if n504 == 0 and n200 >= 1 else '아직 504 발생' if n504 else '응답 대기중'}")


if __name__ == "__main__":
    main()
