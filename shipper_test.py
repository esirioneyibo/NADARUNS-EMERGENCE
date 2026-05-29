#!/usr/bin/env python3
"""
Backend API Testing for NadaRuns Logistics Platform
Tests the shipper shipment creation flow
"""

import requests
import json
import sys
from typing import Dict, Any, Optional

# Get backend URL from environment
BACKEND_URL = "https://keep-building-23.preview.emergentagent.com/api"

# Test credentials
SHIPPER_EMAIL = "demo.shipper@nadaruns.com"
SHIPPER_PASSWORD = "demo1234"

# Color codes for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def print_test(name: str):
    """Print test name."""
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}TEST: {name}{RESET}")
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
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
    except:
        print(f"Response: {response.text[:500]}")

class TestRunner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.shipper_token = None
        self.created_shipment_id = None
        self.created_order_number = None
    
    def test_shipper_login(self) -> bool:
        """Test 1: Shipper login"""
        print_test("Shipper Login")
        
        try:
            response = requests.post(
                f"{BACKEND_URL}/auth/shipper-login",
                json={
                    "email": SHIPPER_EMAIL,
                    "password": SHIPPER_PASSWORD
                },
                timeout=10
            )
            
            print_response(response)
            
            if response.status_code == 200:
                data = response.json()
                if "token" in data:
                    self.shipper_token = data["token"]
                    print_success(f"Shipper login successful. Token received.")
                    print_info(f"Shipper name: {data.get('name', 'N/A')}")
                    self.passed += 1
                    return True
                else:
                    print_error("Login response missing 'token' field")
                    self.failed += 1
                    return False
            else:
                print_error(f"Login failed with status {response.status_code}")
                self.failed += 1
                return False
                
        except Exception as e:
            print_error(f"Login test failed with exception: {str(e)}")
            self.failed += 1
            return False
    
    def test_create_shipment(self) -> bool:
        """Test 2: Create shipment"""
        print_test("Create Shipment")
        
        if not self.shipper_token:
            print_error("Cannot test shipment creation - no auth token")
            self.failed += 1
            return False
        
        try:
            shipment_data = {
                "pickup_address": "Mannerheimintie 10, Helsinki",
                "pickup_lat": 60.1699,
                "pickup_lng": 24.9384,
                "pickup_contact_name": "Test Sender",
                "pickup_contact_phone": "+358401234567",
                "pickup_notes": "Ring doorbell",
                "dropoff_address": "Aleksanterinkatu 52, Helsinki",
                "dropoff_lat": 60.1689,
                "dropoff_lng": 24.9522,
                "dropoff_contact_name": "Test Receiver",
                "dropoff_contact_phone": "+358407654321",
                "dropoff_notes": "Leave at reception",
                "vehicle_type": "cargo_van",
                "cargo_weight_kg": 500,
                "cargo_description": "Test delivery package",
                "cargo_type": "general"
            }
            
            response = requests.post(
                f"{BACKEND_URL}/shipper/shipments",
                json=shipment_data,
                headers={"Authorization": f"Bearer {self.shipper_token}"},
                timeout=10
            )
            
            print_response(response)
            
            if response.status_code in [200, 201]:
                data = response.json()
                
                # Check required fields
                required_fields = ["order_id", "order_number", "status"]
                missing_fields = [f for f in required_fields if f not in data]
                
                if missing_fields:
                    print_error(f"Response missing required fields: {missing_fields}")
                    self.failed += 1
                    return False
                
                self.created_shipment_id = data["order_id"]
                self.created_order_number = data["order_number"]
                
                print_success(f"Shipment created successfully")
                print_info(f"Order ID: {self.created_shipment_id}")
                print_info(f"Order Number: {self.created_order_number}")
                print_info(f"Status: {data.get('status', 'N/A')}")
                print_info(f"Price: €{data.get('price', 'N/A')}")
                print_info(f"Distance: {data.get('distance_km', 'N/A')} km")
                
                self.passed += 1
                return True
            else:
                print_error(f"Shipment creation failed with status {response.status_code}")
                self.failed += 1
                return False
                
        except Exception as e:
            print_error(f"Shipment creation test failed with exception: {str(e)}")
            self.failed += 1
            return False
    
    def test_list_shipments(self) -> bool:
        """Test 3: List shipper's shipments"""
        print_test("List Shipper Shipments")
        
        if not self.shipper_token:
            print_error("Cannot test shipment listing - no auth token")
            self.failed += 1
            return False
        
        try:
            response = requests.get(
                f"{BACKEND_URL}/shipper/shipments",
                headers={"Authorization": f"Bearer {self.shipper_token}"},
                timeout=10
            )
            
            print_response(response)
            
            if response.status_code == 200:
                data = response.json()
                
                if not isinstance(data, list):
                    print_error(f"Expected list response, got {type(data)}")
                    self.failed += 1
                    return False
                
                print_success(f"Retrieved {len(data)} shipments")
                
                # Check if our created shipment is in the list
                if self.created_shipment_id:
                    found = False
                    for shipment in data:
                        if shipment.get("id") == self.created_shipment_id:
                            found = True
                            print_success(f"Found newly created shipment in list")
                            print_info(f"Shipment status: {shipment.get('status', 'N/A')}")
                            break
                    
                    if not found:
                        print_error(f"Newly created shipment not found in list")
                        self.failed += 1
                        return False
                
                self.passed += 1
                return True
            else:
                print_error(f"Shipment listing failed with status {response.status_code}")
                self.failed += 1
                return False
                
        except Exception as e:
            print_error(f"Shipment listing test failed with exception: {str(e)}")
            self.failed += 1
            return False
    
    def test_pending_orders_for_drivers(self) -> bool:
        """Test 4: Verify order is available for drivers"""
        print_test("Verify Order Available for Drivers")
        
        if not self.created_shipment_id:
            print_error("Cannot test pending orders - no shipment created")
            self.failed += 1
            return False
        
        try:
            # Test GET /api/orders/pending (returns single order)
            print_info("Testing GET /api/orders/pending...")
            response = requests.get(
                f"{BACKEND_URL}/orders/pending",
                timeout=10
            )
            
            print_response(response)
            
            if response.status_code == 200:
                data = response.json()
                if data:
                    print_info(f"GET /api/orders/pending returns order: {data.get('order_number', 'N/A')}")
                else:
                    print_info("GET /api/orders/pending returns null (no pending orders)")
            
            # Test GET /api/orders/available (returns list of orders)
            print_info("\nTesting GET /api/orders/available...")
            response = requests.get(
                f"{BACKEND_URL}/orders/available",
                timeout=10
            )
            
            print_response(response)
            
            if response.status_code == 200:
                data = response.json()
                
                if not isinstance(data, list):
                    print_error(f"Expected list response, got {type(data)}")
                    self.failed += 1
                    return False
                
                print_success(f"Retrieved {len(data)} available orders")
                
                # Check if our created order is in the list
                found = False
                for order in data:
                    if order.get("id") == self.created_shipment_id:
                        found = True
                        print_success(f"Found newly created order in available orders list")
                        print_info(f"Order number: {order.get('order_number', 'N/A')}")
                        print_info(f"Status: {order.get('status', 'N/A')}")
                        print_info(f"Vehicle type: {order.get('vehicle_type', 'N/A')}")
                        print_info(f"Cargo weight: {order.get('cargo_weight_kg', 'N/A')} kg")
                        break
                
                if found:
                    print_success("Order is available for drivers to accept")
                    self.passed += 1
                    return True
                else:
                    print_error(f"Newly created order not found in available orders")
                    print_info(f"Looking for order ID: {self.created_shipment_id}")
                    self.failed += 1
                    return False
            else:
                print_error(f"Available orders request failed with status {response.status_code}")
                self.failed += 1
                return False
                
        except Exception as e:
            print_error(f"Pending orders test failed with exception: {str(e)}")
            self.failed += 1
            return False
    
    def run_all_tests(self):
        """Run all tests in sequence."""
        print(f"\n{BLUE}{'='*80}{RESET}")
        print(f"{BLUE}NadaRuns Shipper Shipment Creation Flow Tests{RESET}")
        print(f"{BLUE}Backend URL: {BACKEND_URL}{RESET}")
        print(f"{BLUE}{'='*80}{RESET}")
        
        # Run tests in order
        self.test_shipper_login()
        self.test_create_shipment()
        self.test_list_shipments()
        self.test_pending_orders_for_drivers()
        
        # Print summary
        print(f"\n{BLUE}{'='*80}{RESET}")
        print(f"{BLUE}TEST SUMMARY{RESET}")
        print(f"{BLUE}{'='*80}{RESET}")
        print(f"{GREEN}Passed: {self.passed}{RESET}")
        print(f"{RED}Failed: {self.failed}{RESET}")
        print(f"Total: {self.passed + self.failed}")
        
        if self.failed == 0:
            print(f"\n{GREEN}✓ All tests passed!{RESET}")
            return 0
        else:
            print(f"\n{RED}✗ Some tests failed{RESET}")
            return 1

if __name__ == "__main__":
    runner = TestRunner()
    exit_code = runner.run_all_tests()
    sys.exit(exit_code)
