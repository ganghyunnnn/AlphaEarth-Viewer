"""콘솔 에러 + 스크럽 동작 최종 점검."""
import time
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1100, "height": 800})
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.goto("http://localhost:8080/?zoom=10", wait_until="domcontentloaded")
    pg.wait_for_timeout(8000)  # 로드 + idle 프리페치
    # 스크럽 +1 동작
    pg.keyboard.press("ArrowRight")
    pg.wait_for_timeout(3000)
    b.close()
    print("콘솔/페이지 에러:", errs if errs else "없음 ✅")
