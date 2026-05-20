#!/usr/bin/env python3
"""
Backend API Test Suite for NadaRuns Driver MVP
Tests the Photo Proof at Delivery endpoint and regression checks
"""

import requests
import json
import sys
from typing import Optional, Dict, Any

# Backend URL from frontend/.env
BACKEND_URL = "https://keep-building-23.preview.emergentagent.com/api"

# Test data: 1x1 transparent PNG in base64
SMALL_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
FULL_DATA_URI = f"data:image/jpeg;base64,{SMALL_BASE64}"

# Colors for output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"

test_results = []


def log_test(name: str, passed: bool, details: str = ""):
    """Log test result"""
    status = f"{GREEN}✓ PASS{RESET}" if passed else f"{RED}✗ FAIL{RESET}"
    print(f"{status} | {name}")
    if details:
        print(f"       {details}")
    test_results.append({"name": name, "passed": passed, "details": details})


def get_pending_order() -> Optional[Dict[str, Any]]:
    """Get a pending order for testing"""
    try:
        resp = requests.get(f"{BACKEND_URL}/orders/pending", timeout=10)
        if resp.status_code == 200 and resp.json():
            return resp.json()
        return None
    except Exception as e:
        print(f"{RED}Failed to get pending order: {e}{RESET}")
        return None


def get_active_order() -> Optional[Dict[str, Any]]:
    """Get active order for testing"""
    try:
        resp = requests.get(f"{BACKEND_URL}/orders/active", timeout=10)
        if resp.status_code == 200 and resp.json():
            return resp.json()
        return None
    except Exception as e:
        print(f"{RED}Failed to get active order: {e}{RESET}")
        return None


def accept_order(order_id: str) -> Optional[Dict[str, Any]]:
    """Accept an order"""
    try:
        resp = requests.post(f"{BACKEND_URL}/orders/{order_id}/accept", timeout=10)
        if resp.status_code == 200:
            return resp.json()
        return None
    except Exception as e:
        print(f"{RED}Failed to accept order: {e}{RESET}")
        return None


def advance_order(order_id: str) -> Optional[Dict[str, Any]]:
    """Advance order to next status"""
    try:
        resp = requests.post(f"{BACKEND_URL}/orders/{order_id}/advance", json={}, timeout=10)
        if resp.status_code == 200:
            return resp.json()
        return None
    except Exception as e:
        print(f"{RED}Failed to advance order: {e}{RESET}")
        return None


print(f"\n{'='*80}")
print(f"BACKEND API TEST SUITE - Photo Proof at Delivery")
print(f"Backend URL: {BACKEND_URL}")
print(f"{'='*80}\n")

# ============================================================================
# NEW ENDPOINT TESTS: POST /api/orders/{order_id}/photo
# ============================================================================

print(f"\n{YELLOW}=== NEW ENDPOINT TESTS ==={RESET}\n")

# Test 1: Happy path with full data URI
print("Test 1: Upload photo with full data URI...")
order = get_pending_order()
if order:
    order_id = order["id"]
    try:
        resp = requests.post(
            f"{BACKEND_URL}/orders/{order_id}/photo",
            json={"photo": FULL_DATA_URI},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("delivery_photo") == FULL_DATA_URI:
                log_test("Photo upload with full data URI", True, f"Order {order_id[:8]}... updated")
            else:
                log_test("Photo upload with full data URI", False, f"delivery_photo mismatch: {data.get('delivery_photo')[:50]}...")
        else:
            log_test("Photo upload with full data URI", False, f"HTTP {resp.status_code}: {resp.text[:100]}")
    except Exception as e:
        log_test("Photo upload with full data URI", False, str(e))
else:
    log_test("Photo upload with full data URI", False, "No pending order available")

# Test 2: Happy path with raw base64 (should be normalized)
print("\nTest 2: Upload photo with raw base64 (no prefix)...")
order = get_pending_order()
if not order:
    # Create a new pending order
    try:
        resp = requests.post(f"{BACKEND_URL}/orders/seed-new-pending", timeout=10)
        if resp.status_code == 200:
            order = resp.json()
    except:
        pass

if order:
    order_id = order["id"]
    try:
        resp = requests.post(
            f"{BACKEND_URL}/orders/{order_id}/photo",
            json={"photo": SMALL_BASE64},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            photo = data.get("delivery_photo", "")
            if photo.startswith("data:image/jpeg;base64,"):
                log_test("Photo upload with raw base64 (normalization)", True, "Correctly normalized to data URI")
            else:
                log_test("Photo upload with raw base64 (normalization)", False, f"Not normalized: {photo[:50]}...")
        else:
            log_test("Photo upload with raw base64 (normalization)", False, f"HTTP {resp.status_code}: {resp.text[:100]}")
    except Exception as e:
        log_test("Photo upload with raw base64 (normalization)", False, str(e))
else:
    log_test("Photo upload with raw base64 (normalization)", False, "No order available")

# Test 3: Empty photo string → 400
print("\nTest 3: Upload empty photo string...")
order = get_pending_order()
if not order:
    try:
        resp = requests.post(f"{BACKEND_URL}/orders/seed-new-pending", timeout=10)
        if resp.status_code == 200:
            order = resp.json()
    except:
        pass

if order:
    order_id = order["id"]
    try:
        resp = requests.post(
            f"{BACKEND_URL}/orders/{order_id}/photo",
            json={"photo": ""},
            timeout=10
        )
        if resp.status_code == 400:
            detail = resp.json().get("detail", "")
            if "empty" in detail.lower():
                log_test("Empty photo validation", True, f"Correctly rejected: {detail}")
            else:
                log_test("Empty photo validation", False, f"Wrong error message: {detail}")
        else:
            log_test("Empty photo validation", False, f"Expected 400, got {resp.status_code}")
    except Exception as e:
        log_test("Empty photo validation", False, str(e))
else:
    log_test("Empty photo validation", False, "No order available")

# Test 4: Unknown order id → 404
print("\nTest 4: Upload photo to unknown order...")
try:
    resp = requests.post(
        f"{BACKEND_URL}/orders/unknown-order-id-12345/photo",
        json={"photo": FULL_DATA_URI},
        timeout=10
    )
    if resp.status_code == 404:
        detail = resp.json().get("detail", "")
        if "not found" in detail.lower():
            log_test("Unknown order ID validation", True, f"Correctly returned 404: {detail}")
        else:
            log_test("Unknown order ID validation", False, f"Wrong error message: {detail}")
    else:
        log_test("Unknown order ID validation", False, f"Expected 404, got {resp.status_code}")
except Exception as e:
    log_test("Unknown order ID validation", False, str(e))

# Test 5: Oversized photo → 413
print("\nTest 5: Upload oversized photo (>7.5MB)...")
order = get_pending_order()
if not order:
    try:
        resp = requests.post(f"{BACKEND_URL}/orders/seed-new-pending", timeout=10)
        if resp.status_code == 200:
            order = resp.json()
    except:
        pass

if order:
    order_id = order["id"]
    # Create a string > 7,500,000 characters
    oversized_photo = "A" * 7_500_001
    try:
        resp = requests.post(
            f"{BACKEND_URL}/orders/{order_id}/photo",
            json={"photo": oversized_photo},
            timeout=15
        )
        if resp.status_code == 413:
            detail = resp.json().get("detail", "")
            if "too large" in detail.lower() or "resize" in detail.lower():
                log_test("Oversized photo validation", True, f"Correctly rejected: {detail}")
            else:
                log_test("Oversized photo validation", False, f"Wrong error message: {detail}")
        else:
            log_test("Oversized photo validation", False, f"Expected 413, got {resp.status_code}")
    except Exception as e:
        log_test("Oversized photo validation", False, str(e))
else:
    log_test("Oversized photo validation", False, "No order available")

# Test 6: Photo persists in GET endpoints
print("\nTest 6: Photo persists in GET /api/orders/pending...")
order = get_pending_order()
if not order:
    try:
        resp = requests.post(f"{BACKEND_URL}/orders/seed-new-pending", timeout=10)
        if resp.status_code == 200:
            order = resp.json()
    except:
        pass

if order:
    order_id = order["id"]
    # Upload photo
    try:
        resp = requests.post(
            f"{BACKEND_URL}/orders/{order_id}/photo",
            json={"photo": FULL_DATA_URI},
            timeout=10
        )
        if resp.status_code == 200:
            # Now fetch the order again
            fetched = get_pending_order()
            if fetched and fetched.get("id") == order_id:
                if fetched.get("delivery_photo") == FULL_DATA_URI:
                    log_test("Photo persistence in GET /api/orders/pending", True, "Photo correctly persisted")
                else:
                    log_test("Photo persistence in GET /api/orders/pending", False, f"Photo mismatch: {fetched.get('delivery_photo', 'None')[:50]}...")
            else:
                log_test("Photo persistence in GET /api/orders/pending", False, "Could not fetch order again")
        else:
            log_test("Photo persistence in GET /api/orders/pending", False, f"Photo upload failed: {resp.status_code}")
    except Exception as e:
        log_test("Photo persistence in GET /api/orders/pending", False, str(e))
else:
    log_test("Photo persistence in GET /api/orders/pending", False, "No order available")

# Test 7: Photo persists after delivery completion
print("\nTest 7: Photo persists after delivery completion...")
order = get_pending_order()
if not order:
    try:
        resp = requests.post(f"{BACKEND_URL}/orders/seed-new-pending", timeout=10)
        if resp.status_code == 200:
            order = resp.json()
    except:
        pass

if order:
    order_id = order["id"]
    try:
        # Accept order
        order = accept_order(order_id)
        if not order:
            log_test("Photo persistence after delivery", False, "Failed to accept order")
        else:
            # Advance through all stages to delivered
            while order["status"] != "delivered":
                order = advance_order(order_id)
                if not order:
                    log_test("Photo persistence after delivery", False, "Failed to advance order")
                    break
            
            if order and order["status"] == "delivered":
                # Upload photo
                resp = requests.post(
                    f"{BACKEND_URL}/orders/{order_id}/photo",
                    json={"photo": FULL_DATA_URI},
                    timeout=10
                )
                if resp.status_code == 200:
                    # Check in history
                    resp = requests.get(f"{BACKEND_URL}/orders/history", timeout=10)
                    if resp.status_code == 200:
                        history = resp.json()
                        delivered_order = next((o for o in history if o["id"] == order_id), None)
                        if delivered_order:
                            if delivered_order.get("delivery_photo") == FULL_DATA_URI:
                                log_test("Photo persistence after delivery", True, "Photo persisted in history")
                            else:
                                log_test("Photo persistence after delivery", False, f"Photo not in history: {delivered_order.get('delivery_photo', 'None')[:50]}...")
                        else:
                            log_test("Photo persistence after delivery", False, "Order not found in history")
                    else:
                        log_test("Photo persistence after delivery", False, f"Failed to get history: {resp.status_code}")
                else:
                    log_test("Photo persistence after delivery", False, f"Photo upload failed: {resp.status_code}")
    except Exception as e:
        log_test("Photo persistence after delivery", False, str(e))
else:
    log_test("Photo persistence after delivery", False, "No order available")

# ============================================================================
# REGRESSION TESTS: Existing endpoints must still work
# ============================================================================

print(f"\n{YELLOW}=== REGRESSION TESTS ==={RESET}\n")

# Test: GET /api/orders/pending
print("Test: GET /api/orders/pending...")
try:
    resp = requests.get(f"{BACKEND_URL}/orders/pending", timeout=10)
    if resp.status_code == 200:
        data = resp.json()
        if data is None or (isinstance(data, dict) and "id" in data):
            log_test("GET /api/orders/pending", True, f"Returns order or null")
        else:
            log_test("GET /api/orders/pending", False, f"Unexpected response: {str(data)[:100]}")
    else:
        log_test("GET /api/orders/pending", False, f"HTTP {resp.status_code}")
except Exception as e:
    log_test("GET /api/orders/pending", False, str(e))

# Test: POST /api/orders/{id}/accept
print("\nTest: POST /api/orders/{id}/accept...")
order = get_pending_order()
if not order:
    try:
        resp = requests.post(f"{BACKEND_URL}/orders/seed-new-pending", timeout=10)
        if resp.status_code == 200:
            order = resp.json()
    except:
        pass

if order:
    order_id = order["id"]
    try:
        resp = requests.post(f"{BACKEND_URL}/orders/{order_id}/accept", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") == "accepted":
                log_test("POST /api/orders/{id}/accept", True, f"Order accepted")
            else:
                log_test("POST /api/orders/{id}/accept", False, f"Status not 'accepted': {data.get('status')}")
        else:
            log_test("POST /api/orders/{id}/accept", False, f"HTTP {resp.status_code}")
    except Exception as e:
        log_test("POST /api/orders/{id}/accept", False, str(e))
else:
    log_test("POST /api/orders/{id}/accept", False, "No order available")

# Test: POST /api/orders/{id}/advance
print("\nTest: POST /api/orders/{id}/advance...")
order = get_active_order()
if order:
    order_id = order["id"]
    current_status = order["status"]
    try:
        resp = requests.post(f"{BACKEND_URL}/orders/{order_id}/advance", json={}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") != current_status:
                log_test("POST /api/orders/{id}/advance", True, f"Status progressed from {current_status} to {data.get('status')}")
            else:
                log_test("POST /api/orders/{id}/advance", False, f"Status did not change: {current_status}")
        else:
            log_test("POST /api/orders/{id}/advance", False, f"HTTP {resp.status_code}")
    except Exception as e:
        log_test("POST /api/orders/{id}/advance", False, str(e))
else:
    log_test("POST /api/orders/{id}/advance", False, "No active order available")

# Test: POST /api/orders/{id}/verify-otp (pickup)
print("\nTest: POST /api/orders/{id}/verify-otp (pickup - correct OTP)...")
# Need to get an order in arrived_pickup state
order = get_pending_order()
if not order:
    try:
        resp = requests.post(f"{BACKEND_URL}/orders/seed-new-pending", timeout=10)
        if resp.status_code == 200:
            order = resp.json()
    except:
        pass

if order:
    order_id = order["id"]
    pickup_otp = order.get("pickup_otp")
    try:
        # Accept and advance to arrived_pickup
        accept_order(order_id)
        advance_order(order_id)  # enroute_pickup
        order = advance_order(order_id)  # arrived_pickup
        
        if order and order["status"] == "arrived_pickup":
            resp = requests.post(
                f"{BACKEND_URL}/orders/{order_id}/verify-otp",
                json={"otp": pickup_otp, "kind": "pickup"},
                timeout=10
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("pickup_otp_verified") is True:
                    log_test("POST /api/orders/{id}/verify-otp (pickup correct)", True, "OTP verified")
                else:
                    log_test("POST /api/orders/{id}/verify-otp (pickup correct)", False, "OTP not verified")
            else:
                log_test("POST /api/orders/{id}/verify-otp (pickup correct)", False, f"HTTP {resp.status_code}")
        else:
            log_test("POST /api/orders/{id}/verify-otp (pickup correct)", False, "Could not advance to arrived_pickup")
    except Exception as e:
        log_test("POST /api/orders/{id}/verify-otp (pickup correct)", False, str(e))
else:
    log_test("POST /api/orders/{id}/verify-otp (pickup correct)", False, "No order available")

# Test: POST /api/orders/{id}/verify-otp (wrong OTP)
print("\nTest: POST /api/orders/{id}/verify-otp (pickup - wrong OTP)...")
order = get_active_order()
if order and order["status"] in ["arrived_pickup", "arrived_dropoff"]:
    order_id = order["id"]
    try:
        resp = requests.post(
            f"{BACKEND_URL}/orders/{order_id}/verify-otp",
            json={"otp": "0000", "kind": "pickup"},
            timeout=10
        )
        if resp.status_code == 400:
            detail = resp.json().get("detail", "")
            if "invalid" in detail.lower():
                log_test("POST /api/orders/{id}/verify-otp (wrong OTP)", True, f"Correctly rejected: {detail}")
            else:
                log_test("POST /api/orders/{id}/verify-otp (wrong OTP)", False, f"Wrong error: {detail}")
        else:
            log_test("POST /api/orders/{id}/verify-otp (wrong OTP)", False, f"Expected 400, got {resp.status_code}")
    except Exception as e:
        log_test("POST /api/orders/{id}/verify-otp (wrong OTP)", False, str(e))
else:
    log_test("POST /api/orders/{id}/verify-otp (wrong OTP)", False, "No suitable order available")

# Test: GET /api/orders/history
print("\nTest: GET /api/orders/history (delivery_photo field present)...")
try:
    resp = requests.get(f"{BACKEND_URL}/orders/history", timeout=10)
    if resp.status_code == 200:
        history = resp.json()
        if isinstance(history, list):
            if len(history) > 0:
                # Check that all orders have delivery_photo field
                all_have_field = all("delivery_photo" in order for order in history)
                if all_have_field:
                    log_test("GET /api/orders/history (delivery_photo field)", True, f"{len(history)} orders, all have delivery_photo field")
                else:
                    missing = [o.get("id", "?")[:8] for o in history if "delivery_photo" not in o]
                    log_test("GET /api/orders/history (delivery_photo field)", False, f"Missing field in orders: {missing}")
            else:
                log_test("GET /api/orders/history (delivery_photo field)", True, "No history orders (empty list)")
        else:
            log_test("GET /api/orders/history (delivery_photo field)", False, f"Expected list, got {type(history)}")
    else:
        log_test("GET /api/orders/history (delivery_photo field)", False, f"HTTP {resp.status_code}")
except Exception as e:
    log_test("GET /api/orders/history (delivery_photo field)", False, str(e))

# Test: GET /api/driver/wallet
print("\nTest: GET /api/driver/wallet...")
try:
    resp = requests.get(f"{BACKEND_URL}/driver/wallet", timeout=10)
    if resp.status_code == 200:
        wallet = resp.json()
        if "available_balance" in wallet and "pending_balance" in wallet:
            log_test("GET /api/driver/wallet", True, f"Balance: {wallet['available_balance']}")
        else:
            log_test("GET /api/driver/wallet", False, f"Missing fields: {wallet.keys()}")
    else:
        log_test("GET /api/driver/wallet", False, f"HTTP {resp.status_code}")
except Exception as e:
    log_test("GET /api/driver/wallet", False, str(e))

# Test: GET /api/orders/active
print("\nTest: GET /api/orders/active...")
try:
    resp = requests.get(f"{BACKEND_URL}/orders/active", timeout=10)
    if resp.status_code == 200:
        data = resp.json()
        if data is None or (isinstance(data, dict) and "id" in data):
            log_test("GET /api/orders/active", True, "Returns order or null")
        else:
            log_test("GET /api/orders/active", False, f"Unexpected response: {str(data)[:100]}")
    else:
        log_test("GET /api/orders/active", False, f"HTTP {resp.status_code}")
except Exception as e:
    log_test("GET /api/orders/active", False, str(e))

# ============================================================================
# SUMMARY
# ============================================================================

print(f"\n{'='*80}")
print(f"TEST SUMMARY")
print(f"{'='*80}\n")

passed = sum(1 for t in test_results if t["passed"])
failed = sum(1 for t in test_results if not t["passed"])
total = len(test_results)

print(f"Total: {total} | {GREEN}Passed: {passed}{RESET} | {RED}Failed: {failed}{RESET}\n")

if failed > 0:
    print(f"{RED}FAILED TESTS:{RESET}")
    for t in test_results:
        if not t["passed"]:
            print(f"  ✗ {t['name']}")
            if t["details"]:
                print(f"    → {t['details']}")
    print()

print(f"{'='*80}\n")

# Exit with appropriate code
sys.exit(0 if failed == 0 else 1)
