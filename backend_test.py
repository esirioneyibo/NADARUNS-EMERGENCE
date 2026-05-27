#!/usr/bin/env python3
"""
Backend test suite for NadaRuns logistics vehicle types implementation.
Tests vehicle type endpoints, driver registration with vehicle types, and filtering.
"""

import requests
import json
import sys
from typing import Dict, Any

# Backend API base URL
BASE_URL = "https://keep-building-23.preview.emergentagent.com/api"

# Test results tracking
test_results = {
    "passed": 0,
    "failed": 0,
    "tests": []
}


def log_test(test_name: str, passed: bool, message: str = "", response_data: Any = None):
    """Log test result."""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"\n{status}: {test_name}")
    if message:
        print(f"  Message: {message}")
    if response_data and not passed:
        print(f"  Response: {json.dumps(response_data, indent=2)}")
    
    test_results["tests"].append({
        "name": test_name,
        "passed": passed,
        "message": message
    })
    
    if passed:
        test_results["passed"] += 1
    else:
        test_results["failed"] += 1


def test_vehicle_types_endpoint():
    """Test 1: GET /api/shipper/vehicle-types - Should return list of vehicle types."""
    print("\n" + "="*80)
    print("TEST 1: Vehicle Types Endpoint")
    print("="*80)
    
    try:
        response = requests.get(f"{BASE_URL}/shipper/vehicle-types", timeout=10)
        
        if response.status_code != 200:
            log_test(
                "GET /api/shipper/vehicle-types",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        vehicle_types = response.json()
        
        # Verify it's a list
        if not isinstance(vehicle_types, list):
            log_test(
                "GET /api/shipper/vehicle-types",
                False,
                f"Expected list, got {type(vehicle_types)}",
                vehicle_types
            )
            return
        
        # Verify it has vehicle types
        if len(vehicle_types) == 0:
            log_test(
                "GET /api/shipper/vehicle-types",
                False,
                "Vehicle types list is empty",
                vehicle_types
            )
            return
        
        # Verify structure of vehicle types
        required_fields = ["id", "name", "category", "max_weight_kg", "base_rate_per_km"]
        for vtype in vehicle_types:
            for field in required_fields:
                if field not in vtype:
                    log_test(
                        "GET /api/shipper/vehicle-types",
                        False,
                        f"Vehicle type missing required field: {field}",
                        vtype
                    )
                    return
        
        # Check for expected vehicle types
        vehicle_ids = [v["id"] for v in vehicle_types]
        expected_types = ["cargo_van", "semi_truck", "refrigerated", "tanker"]
        for expected in expected_types:
            if expected not in vehicle_ids:
                log_test(
                    "GET /api/shipper/vehicle-types",
                    False,
                    f"Expected vehicle type '{expected}' not found in response",
                    vehicle_ids
                )
                return
        
        print(f"  Found {len(vehicle_types)} vehicle types")
        print(f"  Vehicle IDs: {vehicle_ids}")
        
        log_test(
            "GET /api/shipper/vehicle-types",
            True,
            f"Successfully retrieved {len(vehicle_types)} vehicle types with correct structure"
        )
        
    except Exception as e:
        log_test(
            "GET /api/shipper/vehicle-types",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_driver_registration_with_vehicle_type():
    """Test 2: POST /api/driver/register with valid vehicle type."""
    print("\n" + "="*80)
    print("TEST 2: Driver Registration with Vehicle Type (semi_truck)")
    print("="*80)
    
    try:
        payload = {
            "first_name": "Test",
            "last_name": "Driver",
            "email": "testdriver_vtype@test.com",
            "phone": "+358401234567",
            "password": "test1234",
            "vehicle_type": "semi_truck",
            "city": "Helsinki"
        }
        
        response = requests.post(f"{BASE_URL}/driver/register", json=payload, timeout=10)
        
        # Accept both 200 and 400 (if driver already exists)
        if response.status_code == 400:
            response_data = response.json()
            if "already exists" in response_data.get("detail", "").lower():
                print("  Note: Driver already exists, testing with existing account")
                log_test(
                    "POST /api/driver/register (semi_truck)",
                    True,
                    "Driver already registered (acceptable for testing)"
                )
                return
        
        if response.status_code != 200:
            log_test(
                "POST /api/driver/register (semi_truck)",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        data = response.json()
        
        # Verify response structure
        required_fields = ["driver_id", "token", "message"]
        for field in required_fields:
            if field not in data:
                log_test(
                    "POST /api/driver/register (semi_truck)",
                    False,
                    f"Response missing required field: {field}",
                    data
                )
                return
        
        print(f"  Driver ID: {data['driver_id']}")
        print(f"  Message: {data['message']}")
        
        log_test(
            "POST /api/driver/register (semi_truck)",
            True,
            "Successfully registered driver with semi_truck vehicle type"
        )
        
    except Exception as e:
        log_test(
            "POST /api/driver/register (semi_truck)",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_driver_registration_invalid_vehicle_type():
    """Test 3: POST /api/driver/register with invalid vehicle type (should fail)."""
    print("\n" + "="*80)
    print("TEST 3: Driver Registration with Invalid Vehicle Type (bicycle)")
    print("="*80)
    
    try:
        payload = {
            "first_name": "Invalid",
            "last_name": "Driver",
            "email": "invalid_vtype@test.com",
            "phone": "+358401234568",
            "password": "test1234",
            "vehicle_type": "bicycle",
            "city": "Helsinki"
        }
        
        response = requests.post(f"{BASE_URL}/driver/register", json=payload, timeout=10)
        
        # Should return 400 error
        if response.status_code != 400:
            log_test(
                "POST /api/driver/register (invalid vehicle_type)",
                False,
                f"Expected status 400 for invalid vehicle type, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        data = response.json()
        error_message = data.get("detail", "")
        
        # Verify error message mentions invalid vehicle type
        if "invalid vehicle type" not in error_message.lower():
            log_test(
                "POST /api/driver/register (invalid vehicle_type)",
                False,
                f"Error message doesn't mention invalid vehicle type: {error_message}",
                data
            )
            return
        
        print(f"  Error message: {error_message}")
        
        log_test(
            "POST /api/driver/register (invalid vehicle_type)",
            True,
            "Correctly rejected invalid vehicle type 'bicycle' with 400 error"
        )
        
    except Exception as e:
        log_test(
            "POST /api/driver/register (invalid vehicle_type)",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_available_orders_with_vehicle_filter():
    """Test 4: GET /api/orders/available with vehicle_type filter."""
    print("\n" + "="*80)
    print("TEST 4: Available Orders with Vehicle Type Filter (cargo_van)")
    print("="*80)
    
    try:
        response = requests.get(
            f"{BASE_URL}/orders/available",
            params={"vehicle_type": "cargo_van"},
            timeout=10
        )
        
        if response.status_code != 200:
            log_test(
                "GET /api/orders/available?vehicle_type=cargo_van",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        orders = response.json()
        
        # Verify it's a list
        if not isinstance(orders, list):
            log_test(
                "GET /api/orders/available?vehicle_type=cargo_van",
                False,
                f"Expected list, got {type(orders)}",
                orders
            )
            return
        
        print(f"  Found {len(orders)} available orders")
        
        # If there are orders, verify they match the filter or have no vehicle type requirement
        for order in orders:
            order_vehicle_type = order.get("vehicle_type")
            if order_vehicle_type is not None and order_vehicle_type != "cargo_van":
                log_test(
                    "GET /api/orders/available?vehicle_type=cargo_van",
                    False,
                    f"Order has vehicle_type '{order_vehicle_type}' which doesn't match filter 'cargo_van'",
                    order
                )
                return
        
        log_test(
            "GET /api/orders/available?vehicle_type=cargo_van",
            True,
            f"Successfully retrieved {len(orders)} orders (filtered by cargo_van or no vehicle requirement)"
        )
        
    except Exception as e:
        log_test(
            "GET /api/orders/available?vehicle_type=cargo_van",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_driver_profile_update_with_vehicle_type():
    """Test 5: PATCH /api/driver/me to update vehicle type."""
    print("\n" + "="*80)
    print("TEST 5: Driver Profile Update with Vehicle Type")
    print("="*80)
    
    try:
        # First, login as the test driver
        login_payload = {
            "email": "testdriver_vtype@test.com",
            "password": "test1234"
        }
        
        login_response = requests.post(f"{BASE_URL}/auth/login", json=login_payload, timeout=10)
        
        if login_response.status_code != 200:
            log_test(
                "PATCH /api/driver/me (vehicle_type update)",
                False,
                f"Failed to login test driver: {login_response.status_code}",
                login_response.json() if login_response.text else None
            )
            return
        
        token = login_response.json().get("token")
        if not token:
            log_test(
                "PATCH /api/driver/me (vehicle_type update)",
                False,
                "No token received from login",
                login_response.json()
            )
            return
        
        print(f"  Successfully logged in")
        
        # Now update the driver profile
        update_payload = {
            "vehicle_type": "refrigerated",
            "vehicle_capacity_kg": 12000
        }
        
        headers = {"Authorization": f"Bearer {token}"}
        update_response = requests.patch(
            f"{BASE_URL}/driver/me",
            json=update_payload,
            headers=headers,
            timeout=10
        )
        
        if update_response.status_code != 200:
            log_test(
                "PATCH /api/driver/me (vehicle_type update)",
                False,
                f"Expected status 200, got {update_response.status_code}",
                update_response.json() if update_response.text else None
            )
            return
        
        driver_data = update_response.json()
        
        # Verify the update was applied
        if driver_data.get("vehicle_type") != "refrigerated":
            log_test(
                "PATCH /api/driver/me (vehicle_type update)",
                False,
                f"Vehicle type not updated. Expected 'refrigerated', got '{driver_data.get('vehicle_type')}'",
                driver_data
            )
            return
        
        if driver_data.get("vehicle_capacity_kg") != 12000:
            log_test(
                "PATCH /api/driver/me (vehicle_type update)",
                False,
                f"Vehicle capacity not updated. Expected 12000, got {driver_data.get('vehicle_capacity_kg')}",
                driver_data
            )
            return
        
        print(f"  Vehicle type updated to: {driver_data.get('vehicle_type')}")
        print(f"  Vehicle capacity updated to: {driver_data.get('vehicle_capacity_kg')} kg")
        
        log_test(
            "PATCH /api/driver/me (vehicle_type update)",
            True,
            "Successfully updated driver vehicle type to 'refrigerated' and capacity to 12000 kg"
        )
        
    except Exception as e:
        log_test(
            "PATCH /api/driver/me (vehicle_type update)",
            False,
            f"Exception occurred: {str(e)}"
        )


def test_simple_driver_registration():
    """Test 6: POST /api/auth/driver-register with vehicle type."""
    print("\n" + "="*80)
    print("TEST 6: Simple Driver Registration (tanker)")
    print("="*80)
    
    try:
        payload = {
            "name": "Simple Driver",
            "email": "simple_vtype@test.com",
            "password": "test1234",
            "vehicle_type": "tanker"
        }
        
        response = requests.post(f"{BASE_URL}/auth/driver-register", json=payload, timeout=10)
        
        # Accept both 200 and 400 (if driver already exists)
        if response.status_code == 400:
            response_data = response.json()
            if "already exists" in response_data.get("detail", "").lower():
                print("  Note: Driver already exists, testing with existing account")
                log_test(
                    "POST /api/auth/driver-register (tanker)",
                    True,
                    "Driver already registered (acceptable for testing)"
                )
                return
        
        if response.status_code != 200:
            log_test(
                "POST /api/auth/driver-register (tanker)",
                False,
                f"Expected status 200, got {response.status_code}",
                response.json() if response.text else None
            )
            return
        
        data = response.json()
        
        # Verify response structure
        required_fields = ["driver_id", "token", "message"]
        for field in required_fields:
            if field not in data:
                log_test(
                    "POST /api/auth/driver-register (tanker)",
                    False,
                    f"Response missing required field: {field}",
                    data
                )
                return
        
        print(f"  Driver ID: {data['driver_id']}")
        print(f"  Message: {data['message']}")
        
        log_test(
            "POST /api/auth/driver-register (tanker)",
            True,
            "Successfully registered driver with tanker vehicle type"
        )
        
    except Exception as e:
        log_test(
            "POST /api/auth/driver-register (tanker)",
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
    print("NadaRuns Backend Test Suite - Logistics Vehicle Types")
    print("="*80)
    print(f"Backend URL: {BASE_URL}")
    
    # Run all tests
    test_vehicle_types_endpoint()
    test_driver_registration_with_vehicle_type()
    test_driver_registration_invalid_vehicle_type()
    test_available_orders_with_vehicle_filter()
    test_driver_profile_update_with_vehicle_type()
    test_simple_driver_registration()
    
    # Print summary
    all_passed = print_summary()
    
    # Exit with appropriate code
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
