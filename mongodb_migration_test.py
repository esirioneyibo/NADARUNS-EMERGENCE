#!/usr/bin/env python3
"""
MongoDB Migration Test Suite for NadaRuns Logistics Platform
Tests all endpoints to ensure MongoDB integration is working correctly.
"""

import requests
import json
import sys
from typing import Dict, Any, Optional

# Backend API base URL
BASE_URL = "https://keep-building-23.preview.emergentagent.com/api"

# Test results tracking
test_results = {
    "passed": 0,
    "failed": 0,
    "tests": []
}

# Store tokens for authenticated requests
tokens = {
    "driver": None,
    "shipper": None,
    "admin": None
}


def log_test(test_name: str, passed: bool, message: str = "", response_data: Any = None):
    """Log test result."""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"\n{status}: {test_name}")
    if message:
        print(f"  Message: {message}")
    if response_data and not passed:
        print(f"  Response: {json.dumps(response_data, indent=2)[:500]}")
    
    test_results["tests"].append({
        "name": test_name,
        "passed": passed,
        "message": message
    })
    
    if passed:
        test_results["passed"] += 1
    else:
        test_results["failed"] += 1


def test_seed_demo():
    """Test 1: POST /api/seed-demo - Should create demo accounts and orders."""
    print("\n" + "="*80)
    print("TEST 1: Seed Demo Data")
    print("="*80)
    
    try:
        response = requests.post(f"{BASE_URL}/seed-demo", timeout=15)
        
        if response.status_code != 200:
            log_test(
                "POST /api/seed-demo",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        data = response.json()
        
        # Verify response structure
        if "message" not in data or "created" not in data:
            log_test(
                "POST /api/seed-demo",
                False,
                "Response missing required fields (message, created)",
                data
            )
            return
        
        created = data.get("created", {})
        print(f"  Message: {data.get('message')}")
        print(f"  Created driver: {created.get('driver')}")
        print(f"  Created shipper: {created.get('shipper')}")
        print(f"  Created orders: {created.get('orders')}")
        print(f"  Created history: {created.get('history')}")
        
        log_test(
            "POST /api/seed-demo",
            True,
            "Successfully seeded demo data"
        )
        
    except Exception as e:
        log_test(
            "POST /api/seed-demo",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_driver_login():
    """Test 2: POST /api/auth/login - Driver authentication."""
    print("\n" + "="*80)
    print("TEST 2: Driver Login")
    print("="*80)
    
    try:
        payload = {
            "email": "demo.driver@nadaruns.com",
            "password": "demo1234"
        }
        
        response = requests.post(f"{BASE_URL}/auth/login", json=payload, timeout=10)
        
        if response.status_code != 200:
            log_test(
                "POST /api/auth/login (driver)",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        data = response.json()
        
        # Verify response structure
        required_fields = ["token", "driver_id", "name"]
        for field in required_fields:
            if field not in data:
                log_test(
                    "POST /api/auth/login (driver)",
                    False,
                    f"Response missing required field: {field}",
                    data
                )
                return
        
        # Store token for subsequent tests
        tokens["driver"] = data["token"]
        
        print(f"  Driver ID: {data['driver_id']}")
        print(f"  Name: {data['name']}")
        print(f"  Token: {data['token'][:20]}...")
        
        log_test(
            "POST /api/auth/login (driver)",
            True,
            f"Successfully logged in as {data['name']}"
        )
        
    except Exception as e:
        log_test(
            "POST /api/auth/login (driver)",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_driver_profile():
    """Test 3: GET /api/driver/me - Get driver profile."""
    print("\n" + "="*80)
    print("TEST 3: Driver Profile (Authenticated)")
    print("="*80)
    
    if not tokens["driver"]:
        log_test(
            "GET /api/driver/me",
            False,
            "No driver token available (login test may have failed)"
        )
        return
    
    try:
        headers = {"Authorization": f"Bearer {tokens['driver']}"}
        response = requests.get(f"{BASE_URL}/driver/me", headers=headers, timeout=10)
        
        if response.status_code != 200:
            log_test(
                "GET /api/driver/me",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        driver = response.json()
        
        # Verify required fields
        required_fields = ["id", "name", "email", "vehicle_type", "vehicle_capacity_kg"]
        for field in required_fields:
            if field not in driver:
                log_test(
                    "GET /api/driver/me",
                    False,
                    f"Driver profile missing required field: {field}",
                    driver
                )
                return
        
        print(f"  Name: {driver['name']}")
        print(f"  Email: {driver['email']}")
        print(f"  Vehicle Type: {driver['vehicle_type']}")
        print(f"  Vehicle Capacity: {driver['vehicle_capacity_kg']} kg")
        
        log_test(
            "GET /api/driver/me",
            True,
            "Successfully retrieved driver profile from MongoDB"
        )
        
    except Exception as e:
        log_test(
            "GET /api/driver/me",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_driver_toggle_online():
    """Test 4: POST /api/driver/toggle-online - Toggle driver status."""
    print("\n" + "="*80)
    print("TEST 4: Driver Toggle Online Status")
    print("="*80)
    
    if not tokens["driver"]:
        log_test(
            "POST /api/driver/toggle-online",
            False,
            "No driver token available"
        )
        return
    
    try:
        headers = {"Authorization": f"Bearer {tokens['driver']}"}
        
        # Toggle online
        response = requests.post(f"{BASE_URL}/driver/toggle-online", headers=headers, timeout=10)
        
        if response.status_code != 200:
            log_test(
                "POST /api/driver/toggle-online",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        driver = response.json()
        
        if "is_online" not in driver:
            log_test(
                "POST /api/driver/toggle-online",
                False,
                "Response missing 'is_online' field",
                driver
            )
            return
        
        print(f"  Driver is now: {'ONLINE' if driver['is_online'] else 'OFFLINE'}")
        
        log_test(
            "POST /api/driver/toggle-online",
            True,
            f"Successfully toggled driver status to {'online' if driver['is_online'] else 'offline'}"
        )
        
    except Exception as e:
        log_test(
            "POST /api/driver/toggle-online",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_driver_wallet():
    """Test 5: GET /api/driver/wallet - Get wallet with transactions."""
    print("\n" + "="*80)
    print("TEST 5: Driver Wallet")
    print("="*80)
    
    if not tokens["driver"]:
        log_test(
            "GET /api/driver/wallet",
            False,
            "No driver token available"
        )
        return
    
    try:
        headers = {"Authorization": f"Bearer {tokens['driver']}"}
        response = requests.get(f"{BASE_URL}/driver/wallet", headers=headers, timeout=10)
        
        if response.status_code != 200:
            log_test(
                "GET /api/driver/wallet",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        wallet = response.json()
        
        # Verify required fields
        required_fields = ["available_balance", "pending_balance", "transactions"]
        for field in required_fields:
            if field not in wallet:
                log_test(
                    "GET /api/driver/wallet",
                    False,
                    f"Wallet response missing required field: {field}",
                    wallet
                )
                return
        
        # Verify transactions is a list
        if not isinstance(wallet["transactions"], list):
            log_test(
                "GET /api/driver/wallet",
                False,
                f"Transactions should be a list, got {type(wallet['transactions'])}",
                wallet
            )
            return
        
        print(f"  Available Balance: €{wallet['available_balance']:.2f}")
        print(f"  Pending Balance: €{wallet['pending_balance']:.2f}")
        print(f"  Transactions: {len(wallet['transactions'])} records")
        
        log_test(
            "GET /api/driver/wallet",
            True,
            f"Successfully retrieved wallet with {len(wallet['transactions'])} transactions"
        )
        
    except Exception as e:
        log_test(
            "GET /api/driver/wallet",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_notifications():
    """Test 6: GET /api/notifications - Get notifications."""
    print("\n" + "="*80)
    print("TEST 6: Notifications")
    print("="*80)
    
    if not tokens["driver"]:
        log_test(
            "GET /api/notifications",
            False,
            "No driver token available"
        )
        return
    
    try:
        headers = {"Authorization": f"Bearer {tokens['driver']}"}
        response = requests.get(f"{BASE_URL}/notifications", headers=headers, timeout=10)
        
        if response.status_code != 200:
            log_test(
                "GET /api/notifications",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        data = response.json()
        
        # Verify required fields
        required_fields = ["notifications", "unread_count"]
        for field in required_fields:
            if field not in data:
                log_test(
                    "GET /api/notifications",
                    False,
                    f"Response missing required field: {field}",
                    data
                )
                return
        
        # Verify notifications is a list
        if not isinstance(data["notifications"], list):
            log_test(
                "GET /api/notifications",
                False,
                f"Notifications should be a list, got {type(data['notifications'])}",
                data
            )
            return
        
        print(f"  Total Notifications: {len(data['notifications'])}")
        print(f"  Unread Count: {data['unread_count']}")
        
        log_test(
            "GET /api/notifications",
            True,
            f"Successfully retrieved {len(data['notifications'])} notifications"
        )
        
    except Exception as e:
        log_test(
            "GET /api/notifications",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_available_orders():
    """Test 7: GET /api/orders/available - Get available logistics orders."""
    print("\n" + "="*80)
    print("TEST 7: Available Orders (Logistics)")
    print("="*80)
    
    try:
        response = requests.get(f"{BASE_URL}/orders/available", timeout=10)
        
        if response.status_code != 200:
            log_test(
                "GET /api/orders/available",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        orders = response.json()
        
        # Verify it's a list
        if not isinstance(orders, list):
            log_test(
                "GET /api/orders/available",
                False,
                f"Expected list, got {type(orders)}",
                orders
            )
            return
        
        print(f"  Found {len(orders)} available orders")
        
        # Verify orders have logistics data
        logistics_orders = 0
        for order in orders:
            # Check for logistics-specific fields
            if order.get("cargo_weight_kg") is not None or order.get("vehicle_type") is not None:
                logistics_orders += 1
                
                # Verify logistics fields structure
                if order.get("cargo_weight_kg"):
                    print(f"    Order {order.get('order_number')}: {order.get('cargo_weight_kg')} kg, vehicle: {order.get('vehicle_type')}")
        
        print(f"  Logistics orders: {logistics_orders}/{len(orders)}")
        
        log_test(
            "GET /api/orders/available",
            True,
            f"Successfully retrieved {len(orders)} orders ({logistics_orders} with logistics data)"
        )
        
    except Exception as e:
        log_test(
            "GET /api/orders/available",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_shipper_login():
    """Test 8: POST /api/auth/shipper-login - Shipper authentication."""
    print("\n" + "="*80)
    print("TEST 8: Shipper Login")
    print("="*80)
    
    try:
        payload = {
            "email": "demo.shipper@nadaruns.com",
            "password": "demo1234"
        }
        
        response = requests.post(f"{BASE_URL}/auth/shipper-login", json=payload, timeout=10)
        
        if response.status_code != 200:
            log_test(
                "POST /api/auth/shipper-login",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        data = response.json()
        
        # Verify response structure
        required_fields = ["token", "name"]
        for field in required_fields:
            if field not in data:
                log_test(
                    "POST /api/auth/shipper-login",
                    False,
                    f"Response missing required field: {field}",
                    data
                )
                return
        
        # Store token
        tokens["shipper"] = data["token"]
        
        print(f"  Shipper Name: {data['name']}")
        print(f"  Token: {data['token'][:20]}...")
        
        log_test(
            "POST /api/auth/shipper-login",
            True,
            f"Successfully logged in as shipper: {data['name']}"
        )
        
    except Exception as e:
        log_test(
            "POST /api/auth/shipper-login",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_admin_login():
    """Test 9: POST /api/auth/admin-login - Admin authentication."""
    print("\n" + "="*80)
    print("TEST 9: Admin Login")
    print("="*80)
    
    try:
        payload = {
            "email": "admin@nadaruns.com",
            "password": "admin123"
        }
        
        response = requests.post(f"{BASE_URL}/auth/admin-login", json=payload, timeout=10)
        
        if response.status_code != 200:
            log_test(
                "POST /api/auth/admin-login",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        data = response.json()
        
        # Verify response structure
        required_fields = ["token", "is_admin"]
        for field in required_fields:
            if field not in data:
                log_test(
                    "POST /api/auth/admin-login",
                    False,
                    f"Response missing required field: {field}",
                    data
                )
                return
        
        # Verify is_admin is true
        if not data.get("is_admin"):
            log_test(
                "POST /api/auth/admin-login",
                False,
                "is_admin should be true for admin login",
                data
            )
            return
        
        # Store token
        tokens["admin"] = data["token"]
        
        print(f"  Admin Name: {data.get('name', 'Admin')}")
        print(f"  Is Admin: {data['is_admin']}")
        print(f"  Token: {data['token'][:20]}...")
        
        log_test(
            "POST /api/auth/admin-login",
            True,
            "Successfully logged in as admin"
        )
        
    except Exception as e:
        log_test(
            "POST /api/auth/admin-login",
            False,
            f"Exception occurred: {str(e)}"
        )


def print_summary():
    """Print test summary."""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"Total Tests: {test_results['passed'] + test_results['failed']}")
    print(f"✅ Passed: {test_results['passed']}")
    print(f"❌ Failed: {test_results['failed']}")
    print("="*80)
    
    if test_results['failed'] > 0:
        print("\nFailed Tests:")
        for test in test_results['tests']:
            if not test['passed']:
                print(f"  ❌ {test['name']}")
                if test['message']:
                    print(f"     {test['message']}")
    
    return test_results['failed'] == 0


def main():
    """Run all tests."""
    print("="*80)
    print("NadaRuns MongoDB Migration Test Suite")
    print("="*80)
    print(f"Backend URL: {BASE_URL}")
    
    # Run all tests in order
    test_seed_demo()
    test_driver_login()
    test_driver_profile()
    test_driver_toggle_online()
    test_driver_wallet()
    test_notifications()
    test_available_orders()
    test_shipper_login()
    test_admin_login()
    
    # Print summary
    all_passed = print_summary()
    
    # Exit with appropriate code
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
