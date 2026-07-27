import json
import os

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("MANIFEST_TEST_URL", "http://127.0.0.1:3000")
SCREENSHOT_DIR = os.environ.get("MANIFEST_SCREENSHOT_DIR", os.environ.get("TEMP", "."))

USER = {
    "id": "user-admin",
    "email": "operacao@tsmex.test",
    "roles": ["ADMIN"],
    "profile": {"name": "Operação"},
}

HUBS = [
    {
        "id": "hub-guarulhos",
        "name": "Hub Guarulhos",
        "code": "GRU",
        "city": "Guarulhos",
        "state": "SP",
        "cityIbgeCode": "3518800",
        "active": True,
    },
    {
        "id": "hub-sao-luis",
        "name": "Hub São Luís",
        "code": "SLZ",
        "city": "São Luís",
        "state": "MA",
        "cityIbgeCode": "2111300",
        "active": True,
    },
]

VEHICLES = [
    {
        "id": "vehicle-truck",
        "name": "Truck",
        "code": "TRUCK",
        "maxWeight": 14000,
        "maxVolume": 45,
        "maxValue": 500000,
        "active": True,
    }
]


def api_route(route):
    path = route.request.url.split("/api/", 1)[-1].split("?", 1)[0]
    if path == "hubs":
        payload = {"success": True, "data": HUBS}
    elif path == "vehicle-types":
        payload = {"success": True, "data": VEHICLES}
    elif path == "locations/search":
        payload = {
            "success": True,
            "data": [
                {
                    "id": "city-fortaleza",
                    "name": "Fortaleza",
                    "ibgeCode": "2304400",
                    "state": {"code": "CE", "name": "Ceará"},
                }
            ],
        }
    elif path == "settings/branding":
        payload = {"success": True, "data": None}
    else:
        payload = {"success": True, "data": []}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))


def validate_viewport(browser, width, height, filename):
    page = browser.new_page(viewport={"width": width, "height": height})
    auth_state = {
        "state": {
            "user": USER,
            "token": "visual-test-token",
            "isAuthenticated": True,
            "currentRole": "ADMIN",
        },
        "version": 0,
    }
    page.add_init_script(
        f"""(() => {{
            localStorage.setItem('token', 'visual-test-token');
            localStorage.setItem('auth-storage', {json.dumps(json.dumps(auth_state))});
        }})()"""
    )
    page.route("**/api/**", api_route)
    page.on("console", lambda message: print(f"BROWSER {message.type}: {message.text}"))
    page.on("pageerror", lambda error: print(f"BROWSER ERROR: {error}"))
    page.goto(f"{BASE_URL}/#/manifests/new", wait_until="networkidle")

    try:
        page.get_by_role("heading", name="Para onde esta viagem vai?").wait_for(timeout=10_000)
    except Exception:
        print(f"URL: {page.url}")
        stored_auth = page.evaluate("localStorage.getItem('auth-storage')")
        print(f"AUTH: {stored_auth}")
        print(page.locator("body").inner_text()[:4000])
        raise
    page.get_by_role("radio", name="Entrega direta Até o destino final").click()
    page.get_by_label("Unidade responsável", exact=True).select_option("hub-guarulhos")

    origin = page.get_by_label("Origem da viagem")
    assert origin.is_editable(), "A origem sugerida precisa continuar editável."
    assert origin.input_value() == "Guarulhos, SP"

    destination = page.get_by_label("Destino principal")
    destination.fill("Fortaleza")
    page.get_by_role("button", name="Fortaleza, CE").click()
    assert destination.input_value() == "Fortaleza, CE"

    page.get_by_label("Tipo de veículo").select_option("vehicle-truck")
    assert "14.000 kg" in page.locator("body").inner_text()

    page.evaluate("window.scrollTo(0, 0)")
    screenshot_path = os.path.join(SCREENSHOT_DIR, filename)
    page.screenshot(path=screenshot_path, full_page=True)
    overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    if overflow > 1:
        offenders = page.evaluate(
            """[...document.querySelectorAll('*')]
              .map((element) => {
                const box = element.getBoundingClientRect();
                return { tag: element.tagName, className: String(element.className || ''), text: (element.textContent || '').trim().slice(0, 80), left: box.left, right: box.right, width: box.width };
              })
              .filter((item) => item.right > window.innerWidth + 1 || item.left < -1)
              .sort((a, b) => b.right - a.right)
              .slice(0, 12)"""
        )
        print(json.dumps(offenders, ensure_ascii=False, indent=2))
    assert overflow <= 1, f"Há rolagem horizontal de {overflow}px no viewport {width}px."

    print(screenshot_path)
    page.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    validate_viewport(browser, 390, 844, "manifest-create-mobile.png")
    validate_viewport(browser, 1440, 1000, "manifest-create-desktop.png")
    browser.close()
