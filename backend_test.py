#!/usr/bin/env python3
"""
Backend API Tests for NadaRuns Driver Profile and History Endpoints
Tests driver authentication, profile updates, and order history filtering.
"""

import requests
import json
import sys
from typing import Dict, Any

# Backend URL from environment
BACKEND_URL = "https://keep-building-23.preview.emergentagent.com/api"

# Test credentials
DRIVER_EMAIL = "demo.driver@nadaruns.com"
DRIVER_PASSWORD = "demo1234"

# Color codes for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def print_test(test_name: str):
    """Print test name."""
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}TEST: {test_name}{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")

def print_success(message: str):
    """Print success message."""
    print(f"{GREEN}✓ {message}{RESET}")

def print_error(message: str):
    """Print error message."""
    print(f"{RED}✗ {message}{RESET}")

def print_info(message: str):
    """Print info message."""
    print(f"{YELLOW}ℹ {message}{RESET}")

def print_response(response: requests.Response):
    """Print response details."""
    print(f"Status: {response.status_code}")
    try:
        print(f"Response: {json.dumps(response.json(), indent=2)}")
    except:
        print(f"Response: {response.text}")

class TestRunner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.jwt_token = None
        self.driver_id = None
        self.original_driver_data = None
    
    def test_seed_demo(self):
        """Test 1: Seed demo data"""
        print_test("Test 1: Seed Demo Data (POST /api/seed-demo)")
        
        try:
            response = requests.post(f"{BACKEND_URL}/seed-demo", timeout=10)
            print_response(response)
            
            if response.status_code == 200:
                data = response.json()
                if "message" in data and "created" in data:
                    print_success("Seed demo endpoint working correctly")
                    print_info(f"Created: {json.dumps(data['created'], indent=2)}")
                    self.passed += 1
                    return True
                else:
                    print_error("Response missing expected fields")
                    self.failed += 1
                    return False
            else:
                print_error(f"Expected 200, got {response.status_code}")
                self.failed += 1
                return False
        except Exception as e:
            print_error(f"Exception: {str(e)}")
            self.failed += 1
            return False
    
    def test_driver_login(self):
        """Test 2: Driver login"""
        print_test("Test 2: Driver Login (POST /api/auth/login)")
        
        try:
            payload = {
                "email": DRIVER_EMAIL,
                "password": DRIVER_PASSWORD
            }
            response = requests.post(f"{BACKEND_URL}/auth/login", json=payload, timeout=10)
            print_response(response)
            
            if response.status_code == 200:
                data = response.json()
                if "token" in data and "driver_id" in data:
                    self.jwt_token = data["token"]
                    self.driver_id = data["driver_id"]
                    print_success("Driver login successful")
                    print_info(f"JWT Token: {self.jwt_token[:50]}...")
                    print_info(f"Driver ID: {self.driver_id}")
                    print_info(f"Driver Name: {data.get('name')}")
                    self.passed += 1
                    return True
                else:
                    print_error("Response missing token or driver_id")
                    self.failed += 1
                    return False
            else:
                print_error(f"Expected 200, got {response.status_code}")
                self.failed += 1
                return False
        except Exception as e:
            print_error(f"Exception: {str(e)}")
            self.failed += 1
            return False
    
    def test_get_driver_profile(self):
        """Test 3: Get driver profile"""
        print_test("Test 3: Get Driver Profile (GET /api/driver/me)")
        
        if not self.jwt_token:
            print_error("No JWT token available. Skipping test.")
            self.failed += 1
            return False
        
        try:
            headers = {"Authorization": f"Bearer {self.jwt_token}"}
            response = requests.get(f"{BACKEND_URL}/driver/me", headers=headers, timeout=10)
            print_response(response)
            
            if response.status_code == 200:
                data = response.json()
                # Store original data for comparison
                self.original_driver_data = data
                
                # Verify required fields
                required_fields = ["id", "name", "email", "vehicle_type", "plate"]
                missing_fields = [f for f in required_fields if f not in data]
                
                if missing_fields:
                    print_error(f"Missing required fields: {missing_fields}")
                    self.failed += 1
                    return False
                
                print_success("Driver profile retrieved successfully")
                print_info(f"Driver ID: {data.get('id')}")
                print_info(f"Name: {data.get('name')}")
                print_info(f"Email: {data.get('email')}")
                print_info(f"Vehicle Type: {data.get('vehicle_type')}")
                print_info(f"Plate: {data.get('plate')}")
                print_info(f"Vehicle Capacity: {data.get('vehicle_capacity_kg')} kg")
                self.passed += 1
                return True
            else:
                print_error(f"Expected 200, got {response.status_code}")
                self.failed += 1
                return False
        except Exception as e:
            print_error(f"Exception: {str(e)}")
            self.failed += 1
            return False
    
    def test_update_driver_profile(self):
        """Test 4: Update driver profile"""
        print_test("Test 4: Update Driver Profile (PATCH /api/driver/me)")
        
        if not self.jwt_token:
            print_error("No JWT token available. Skipping test.")
            self.failed += 1
            return False
        
        try:
            # Update driver profile with new data
            update_payload = {
                "name": "Updated Driver Name",
                "plate": "XYZ-999",
                "vehicle_type": "box_truck"
            }
            
            headers = {"Authorization": f"Bearer {self.jwt_token}"}
            response = requests.patch(
                f"{BACKEND_URL}/driver/me", 
                json=update_payload, 
                headers=headers, 
                timeout=10
            )
            print_response(response)
            
            if response.status_code == 200:
                data = response.json()
                
                # Verify updates were applied
                if data.get("name") == "Updated Driver Name":
                    print_success("Name updated correctly")
                else:
                    print_error(f"Name not updated. Expected 'Updated Driver Name', got '{data.get('name')}'")
                    self.failed += 1
                    return False
                
                if data.get("plate") == "XYZ-999":
                    print_success("Plate updated correctly")
                else:
                    print_error(f"Plate not updated. Expected 'XYZ-999', got '{data.get('plate')}'")
                    self.failed += 1
                    return False
                
                if data.get("vehicle_type") == "box_truck":
                    print_success("Vehicle type updated correctly")
                else:
                    print_error(f"Vehicle type not updated. Expected 'box_truck', got '{data.get('vehicle_type')}'")
                    self.failed += 1
                    return False
                
                # Check if vehicle string was updated
                vehicle_str = data.get("vehicle", "")
                if "Box Truck" in vehicle_str and "XYZ-999" in vehicle_str:
                    print_success(f"Vehicle string updated correctly: {vehicle_str}")
                else:
                    print_info(f"Vehicle string: {vehicle_str}")
                
                print_success("Driver profile updated successfully")
                print_info(f"Updated Name: {data.get('name')}")
                print_info(f"Updated Plate: {data.get('plate')}")
                print_info(f"Updated Vehicle Type: {data.get('vehicle_type')}")
                print_info(f"Updated Vehicle: {data.get('vehicle')}")
                self.passed += 1
                return True
            else:
                print_error(f"Expected 200, got {response.status_code}")
                self.failed += 1
                return False
        except Exception as e:
            print_error(f"Exception: {str(e)}")
            self.failed += 1
            return False
    
    def test_verify_update_persisted(self):
        """Test 5: Verify update persisted"""
        print_test("Test 5: Verify Update Persisted (GET /api/driver/me)")
        
        if not self.jwt_token:
            print_error("No JWT token available. Skipping test.")
            self.failed += 1
            return False
        
        try:
            headers = {"Authorization": f"Bearer {self.jwt_token}"}
            response = requests.get(f"{BACKEND_URL}/driver/me", headers=headers, timeout=10)
            print_response(response)
            
            if response.status_code == 200:
                data = response.json()
                
                # Verify updates persisted
                checks_passed = True
                
                if data.get("name") == "Updated Driver Name":
                    print_success("Name persisted correctly")
                else:
                    print_error(f"Name not persisted. Expected 'Updated Driver Name', got '{data.get('name')}'")
                    checks_passed = False
                
                if data.get("plate") == "XYZ-999":
                    print_success("Plate persisted correctly")
                else:
                    print_error(f"Plate not persisted. Expected 'XYZ-999', got '{data.get('plate')}'")
                    checks_passed = False
                
                if data.get("vehicle_type") == "box_truck":
                    print_success("Vehicle type persisted correctly")
                else:
                    print_error(f"Vehicle type not persisted. Expected 'box_truck', got '{data.get('vehicle_type')}'")
                    checks_passed = False
                
                if checks_passed:
                    print_success("All updates persisted successfully")
                    self.passed += 1
                    return True
                else:
                    print_error("Some updates did not persist")
                    self.failed += 1
                    return False
            else:
                print_error(f"Expected 200, got {response.status_code}")
                self.failed += 1
                return False
        except Exception as e:
            print_error(f"Exception: {str(e)}")
            self.failed += 1
            return False
    
    def test_order_history(self):
        """Test 6: Get order history for authenticated driver"""
        print_test("Test 6: Get Order History (GET /api/orders/history)")
        
        if not self.jwt_token:
            print_error("No JWT token available. Skipping test.")
            self.failed += 1
            return False
        
        try:
            headers = {"Authorization": f"Bearer {self.jwt_token}"}
            response = requests.get(f"{BACKEND_URL}/orders/history", headers=headers, timeout=10)
            print_response(response)
            
            if response.status_code == 200:
                data = response.json()
                
                if not isinstance(data, list):
                    print_error("Expected list response")
                    self.failed += 1
                    return False
                
                print_success(f"Order history retrieved successfully ({len(data)} orders)")
                
                # Verify all orders belong to this driver
                if len(data) > 0:
                    all_belong_to_driver = True
                    for order in data:
                        if order.get("driver_id") != self.driver_id:
                            print_error(f"Order {order.get('id')} does not belong to driver {self.driver_id}")
                            all_belong_to_driver = False
                        
                        if order.get("status") != "delivered":
                            print_error(f"Order {order.get('id')} status is not 'delivered': {order.get('status')}")
                            all_belong_to_driver = False
                    
                    if all_belong_to_driver:
                        print_success("All orders belong to the authenticated driver")
                        print_success("All orders have status 'delivered'")
                    else:
                        print_error("Some orders do not belong to the authenticated driver or have wrong status")
                        self.failed += 1
                        return False
                else:
                    print_info("No order history found (empty list is valid)")
                
                # Print sample order details if available
                if len(data) > 0:
                    sample_order = data[0]
                    print_info(f"Sample Order ID: {sample_order.get('id')}")
                    print_info(f"Sample Order Number: {sample_order.get('order_number')}")
                    print_info(f"Sample Order Status: {sample_order.get('status')}")
                    print_info(f"Sample Order Driver ID: {sample_order.get('driver_id')}")
                
                self.passed += 1
                return True
            else:
                print_error(f"Expected 200, got {response.status_code}")
                self.failed += 1
                return False
        except Exception as e:
            print_error(f"Exception: {str(e)}")
            self.failed += 1
            return False
    
    def run_all_tests(self):
        """Run all tests in sequence"""
        print(f"\n{BLUE}{'='*80}{RESET}")
        print(f"{BLUE}NadaRuns Backend API Tests - Driver Profile & History{RESET}")
        print(f"{BLUE}Backend URL: {BACKEND_URL}{RESET}")
        print(f"{BLUE}{'='*80}{RESET}")
        
        # Run tests in sequence
        self.test_seed_demo()
        self.test_driver_login()
        self.test_get_driver_profile()
        self.test_update_driver_profile()
        self.test_verify_update_persisted()
        self.test_order_history()
        
        # Print summary
        print(f"\n{BLUE}{'='*80}{RESET}")
        print(f"{BLUE}TEST SUMMARY{RESET}")
        print(f"{BLUE}{'='*80}{RESET}")
        print(f"{GREEN}Passed: {self.passed}{RESET}")
        print(f"{RED}Failed: {self.failed}{RESET}")
        print(f"Total: {self.passed + self.failed}")
        
        if self.failed == 0:
            print(f"\n{GREEN}✓ ALL TESTS PASSED{RESET}")
            return 0
        else:
            print(f"\n{RED}✗ SOME TESTS FAILED{RESET}")
            return 1

if __name__ == "__main__":
    runner = TestRunner()
    exit_code = runner.run_all_tests()
    sys.exit(exit_code)
