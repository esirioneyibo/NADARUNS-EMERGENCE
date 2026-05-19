# NadaRuns – Complete Project Architecture

## Overview

NadaRuns is a modern logistics platform connecting drivers, businesses, and admins to reduce empty delivery runs through intelligent job matching and real-time tracking.

---

## Technology Stack

### Backend
- **Runtime**: Node.js / NestJS
- **Database**: PostgreSQL + Redis
- **Real-time**: WebSockets (Socket.io)
- **Authentication**: JWT + OAuth2
- **File Storage**: AWS S3 / MinIO
- **Queue System**: Bull (Redis-backed)
- **API**: RESTful + GraphQL (optional)

### Frontend Website
- **Framework**: Next.js 14+ with React
- **Styling**: TailwindCSS
- **Animation**: Framer Motion
- **Maps**: Mapbox GL or Google Maps
- **State**: TanStack Query + Zustand

### Mobile App (Driver & Business)
- **Framework**: React Native (Expo)
- **State Management**: Redux Toolkit / Zustand
- **Real-time**: Socket.io client
- **Maps**: react-native-maps + Google Maps SDK
- **Push Notifications**: Firebase Cloud Messaging
- **Local Storage**: AsyncStorage + MMKV

### Admin Dashboard
- **Framework**: Next.js / React
- **Admin UI**: shadcn/ui or Ant Design Pro
- **Real-time Maps**: Mapbox GL
- **Analytics**: Recharts / Nivo
- **State**: TanStack Query + Redux

---

## Project Structure

```
nadaruns/
├── backend/                      # Node.js/NestJS API
│   ├── src/
│   │   ├── config/               # Configuration
│   │   ├── modules/              # Domain modules
│   │   │   ├── auth/
│   │   │   ├── users/
│   │   │   ├── drivers/
│   │   │   ├── orders/
│   │   │   ├── shipments/
│   │   │   ├── payments/
│   │   │   ├── tracking/
│   │   │   ├── analytics/
│   │   │   └── notifications/
│   │   ├── common/               # Shared utilities
│   │   │   ├── decorators/
│   │   │   ├── filters/
│   │   │   ├── guards/
│   │   │   ├── pipes/
│   │   │   ├── middleware/
│   │   │   ├── interceptors/
│   │   │   └── utils/
│   │   ├── database/             # Database setup
│   │   │   ├── migrations/
│   │   │   ├── seeds/
│   │   │   └── entities/
│   │   ├── cache/                # Redis cache layer
│   │   ├── queue/                # Job queue (Bull)
│   │   ├── websocket/            # Real-time events
│   │   └── main.ts
│   ├── test/                     # Tests
│   ├── .env.example
│   ├── docker-compose.yml
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                     # Next.js Website
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Home
│   │   ├── (public)/
│   │   │   ├── about/
│   │   │   ├── drivers/
│   │   │   ├── business/
│   │   │   ├── pricing/
│   │   │   ├── contact/
│   │   │   └── faq/
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   ├── signup/
│   │   │   └── forgot-password/
│   │   └── blog/
│   ├── components/
│   │   ├── common/
│   │   ├── sections/
│   │   ├── forms/
│   │   └── ui/
│   ├── lib/
│   │   ├── api.ts
│   │   ├── auth.ts
│   │   └── utils.ts
│   ├── hooks/
│   ├── store/                    # State management
│   ├── types/
│   ├── styles/
│   └── public/
│
├── mobile/                       # React Native (Driver & Business Apps)
│   ├── driver-app/               # Driver application
│   │   ├── app/
│   │   │   ├── _layout.tsx
│   │   │   ├── (onboarding)/
│   │   │   ├── (auth)/
│   │   │   ├── (app)/
│   │   │   │   ├── map.tsx
│   │   │   │   ├── orders.tsx
│   │   │   │   ├── active-delivery.tsx
│   │   │   │   ├── history.tsx
│   │   │   │   ├── wallet.tsx
│   │   │   │   ├── profile.tsx
│   │   │   │   └── settings.tsx
│   │   │   └── +html.tsx
│   │   ├── src/
│   │   │   ├── api/
│   │   │   ├── components/
│   │   │   │   ├── common/
│   │   │   │   ├── screens/
│   │   │   │   ├── modals/
│   │   │   │   └── ui/
│   │   │   ├── store/            # Redux store
│   │   │   ├── hooks/
│   │   │   ├── types/
│   │   │   ├── utils/
│   │   │   ├── services/
│   │   │   │   ├── location.ts
│   │   │   │   ├── notification.ts
│   │   │   │   ├── order.ts
│   │   │   │   └── tracking.ts
│   │   │   ├── theme/
│   │   │   └── navigation/
│   │   ├── assets/
│   │   ├── app.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── business-app/             # Business/Shipper application
│       ├── app/
│       ├── src/
│       └── ... (similar structure)
│
├── admin/                        # Admin Dashboard (Next.js)
│   ├── app/
│   │   ├── dashboard/
│   │   │   ├── page.tsx
│   │   │   ├── orders/
│   │   │   ├── drivers/
│   │   │   ├── users/
│   │   │   ├── tracking/
│   │   │   ├── payments/
│   │   │   ├── analytics/
│   │   │   └── support/
│   │   ├── auth/
│   │   └── layout.tsx
│   ├── components/
│   │   ├── dashboard/
│   │   ├── forms/
│   │   ├── tables/
│   │   └── charts/
│   ├── lib/
│   ├── hooks/
│   ├── store/
│   └── types/
│
├── infrastructure/               # Infrastructure & DevOps
│   ├── docker/
│   ├── kubernetes/
│   ├── nginx/
│   ├── terraform/
│   └── ci-cd/
│
├── database/                     # Database schemas & migrations
│   ├── migrations/
│   ├── seeds/
│   └── schemas/
│
├── docs/                         # Documentation
│   ├── API.md
│   ├── DATABASE.md
│   ├── DEPLOYMENT.md
│   ├── DEVELOPMENT.md
│   └── ARCHITECTURE.md
│
├── .github/
│   └── workflows/                # CI/CD workflows
│
└── docker-compose.yml            # Local development
```

---

## Database Schema

### Core Entities

#### Users (Role-based)
- User ID
- Email
- Password Hash
- Phone
- Role (driver, business, admin, super_admin)
- Status (active, suspended, blocked)
- Created At / Updated At

#### Drivers
- Driver ID (FK: Users)
- License Number
- License Expiry
- Vehicle ID
- Insurance Number
- Rating (1-5)
- Total Deliveries
- Total Earnings
- Status (offline, online, on_delivery)
- Location (lat, lng)
- Last Location Update
- KYC Status
- Documents (verified, pending, rejected)

#### Vehicles
- Vehicle ID
- Driver ID (FK)
- Vehicle Type (motorcycle, car, van, truck)
- Registration Number
- Make / Model / Year
- Capacity (weight, volume)
- Status (active, inactive)
- Insurance Expiry
- Last Service Date

#### Businesses/Companies
- Business ID (FK: Users)
- Company Name
- Registration Number
- Tax ID
- Address
- Phone
- Billing Contact
- Subscription Plan
- KYC Status
- Documents Status

#### Orders/Shipments
- Order ID
- Business ID (FK)
- Pickup Location (address, lat, lng)
- Dropoff Location (address, lat, lng)
- Status (pending, accepted, picked_up, in_transit, delivered, cancelled)
- Driver ID (FK) - null until accepted
- Order Type (parcel, freight, document)
- Description
- Weight
- Dimensions
- Special Instructions
- Scheduled For
- Created At / Accepted At / Completed At
- Rating & Review
- Issue/Dispute Status

#### Transactions
- Transaction ID
- User ID (FK)
- Type (earning, payment, refund, bonus)
- Amount
- Currency
- Status (pending, completed, failed)
- Reference (order_id, payment_id)
- Created At

#### Real-Time Tracking
- Tracking ID
- Order ID (FK)
- Driver Location (lat, lng, timestamp)
- Status
- ETA
- Distance Remaining

---

## API Structure

### Authentication Endpoints
```
POST   /api/v1/auth/register         # User registration
POST   /api/v1/auth/login            # Login
POST   /api/v1/auth/refresh          # Refresh token
POST   /api/v1/auth/logout           # Logout
POST   /api/v1/auth/verify-otp       # OTP verification
```

### Driver Endpoints
```
GET    /api/v1/drivers/me            # Get driver profile
PUT    /api/v1/drivers/me            # Update profile
GET    /api/v1/drivers/nearby-jobs   # Get available jobs
GET    /api/v1/drivers/orders/active # Active delivery
POST   /api/v1/drivers/orders/{id}/accept    # Accept order
POST   /api/v1/drivers/orders/{id}/pickup    # Confirm pickup
POST   /api/v1/drivers/orders/{id}/deliver   # Confirm delivery
GET    /api/v1/drivers/earnings      # Earnings & wallet
GET    /api/v1/drivers/history       # Delivery history
GET    /api/v1/drivers/rating        # Rating & reviews
POST   /api/v1/drivers/location      # Update location
```

### Business/Shipper Endpoints
```
POST   /api/v1/shipments             # Create shipment
GET    /api/v1/shipments             # List shipments
GET    /api/v1/shipments/{id}        # Get shipment details
PUT    /api/v1/shipments/{id}        # Update shipment
DELETE /api/v1/shipments/{id}        # Cancel shipment
GET    /api/v1/shipments/{id}/tracking # Real-time tracking
```

### Admin Endpoints
```
GET    /api/v1/admin/dashboard       # Dashboard metrics
GET    /api/v1/admin/drivers         # Manage drivers
GET    /api/v1/admin/orders          # Manage orders
GET    /api/v1/admin/users           # Manage users
POST   /api/v1/admin/drivers/{id}/approve
POST   /api/v1/admin/drivers/{id}/suspend
GET    /api/v1/admin/analytics       # Analytics
GET    /api/v1/admin/support         # Support tickets
```

---

## Real-Time Architecture

### WebSocket Events

**Driver Namespace** (`/driver`)
```
// Server -> Client
driver:order-request          # New order notification
driver:order-cancelled        # Order cancelled
driver:navigation-update      # Navigation/ETA updates
driver:chat-message          # Customer chat

// Client -> Server
driver:accept-order          # Driver accepts order
driver:reject-order          # Driver rejects order
driver:location-update       # Real-time location
driver:arrived-pickup        # Arrival at pickup
driver:arrived-dropoff       # Arrival at dropoff
```

**Business Namespace** (`/business`)
```
// Server -> Client
shipment:driver-assigned     # Driver assigned
shipment:status-update       # Status change
shipment:location-update     # Real-time location
shipment:delivered          # Delivery complete

// Client -> Server
shipment:track              # Track shipment
shipment:cancel             # Cancel shipment
```

**Admin Namespace** (`/admin`)
```
// Real-time monitoring
admin:driver-online         # Driver comes online
admin:driver-offline        # Driver goes offline
admin:order-created         # New order
admin:order-completed       # Order completed
admin:system-alert          # System alerts
```

---

## Authentication Flow

### JWT Strategy
```
Access Token:
- TTL: 15 minutes
- Payload: user_id, role, permissions

Refresh Token:
- TTL: 7 days
- Stored in secure HTTPOnly cookie

Multi-factor:
- OTP via SMS/Email for sensitive operations
```

### OAuth2 (Optional)
```
- Google OAuth for quick signup
- Apple Sign-In for iOS
```

---

## State Management

### Backend State (Redis)
```
driver:online-set          # Set of online drivers
driver:{id}:location       # Current location
order:{id}:status          # Order status cache
user:{id}:session          # User sessions
```

### Frontend State (React/Redux)
```
auth/                       # Authentication
user/                       # User profile
orders/                     # Orders list
tracking/                   # Real-time tracking
notifications/              # Push notifications
```

---

## Key Features Implementation

### 1. Order Matching Algorithm
- Geo-spatial querying (PostGIS)
- Distance-based matching
- Driver capacity matching
- Estimated delivery time
- Pricing algorithm

### 2. Real-Time Tracking
- WebSocket location updates
- ETA calculation
- Route optimization
- Traffic awareness

### 3. Push Notifications
- Firebase Cloud Messaging (FCM)
- Local notifications for offline
- Notification queueing

### 4. Payment Processing
- Stripe / PayPal integration
- Wallet system
- Auto-settlement
- Payout management

### 5. Driver Verification
- Document upload & verification
- Background check integration
- Insurance verification
- KYC compliance

---

## Security Measures

- **API Security**: Rate limiting, API keys, CORS
- **Data Encryption**: End-to-end encryption for sensitive data
- **Authentication**: JWT + Refresh tokens
- **Authorization**: Role-based access control (RBAC)
- **Payment Security**: PCI DSS compliance
- **Data Protection**: GDPR compliance
- **Audit Logging**: All critical actions logged

---

## Deployment Strategy

### Development
```
Local: docker-compose with PostgreSQL, Redis, Backend, Mobile Simulator
```

### Staging
```
Cloud VPS: Docker containers, PostgreSQL, Redis, SSL/TLS
```

### Production
```
Kubernetes: Auto-scaling, Load balancing, CDN, Multi-region failover
Database: Managed PostgreSQL with backups
Cache: Redis cluster
File Storage: AWS S3 / MinIO
```

---

## CI/CD Pipeline

1. **Code Push**: GitHub/GitLab
2. **Automated Tests**: Jest, Detox (mobile)
3. **Build**: Docker image build
4. **Registry**: Push to Docker registry
5. **Deploy**: Kubernetes deployment / VPS update
6. **Verification**: Health checks, smoke tests
7. **Monitoring**: Datadog / ELK stack

---

## Performance Targets

- API Response Time: < 200ms (p95)
- Real-time Update Latency: < 100ms
- Mobile App Load Time: < 2s
- Map Rendering: 60 FPS
- WebSocket Connection: < 1s

---

## Scalability Considerations

- Horizontal scaling with load balancer
- Database read replicas
- Redis cluster
- CDN for static assets
- Message queue for async processing
- Microservices architecture (future)

---

## Monitoring & Observability

- **Logs**: ELK Stack / Datadog
- **Metrics**: Prometheus
- **Tracing**: Jaeger
- **Error Tracking**: Sentry
- **Uptime Monitoring**: UptimeRobot / Datadog

