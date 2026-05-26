# NadaRuns Web - Marketing Website & Admin Dashboard

This folder contains the combined marketing website and admin dashboard for NadaRuns.

## Tech Stack
- **Framework**: Next.js 16 with App Router
- **Styling**: Tailwind CSS v4
- **Language**: TypeScript

## Structure
```
src/
├── app/
│   ├── page.tsx          # Home page
│   ├── about/            # About page
│   ├── drivers/          # For Drivers page
│   ├── business/         # For Business page
│   ├── contact/          # Contact page
│   └── admin/            # Admin Dashboard
│       └── page.tsx      # Admin login & dashboard
├── components/
│   ├── Navbar.tsx        # Navigation bar
│   └── Footer.tsx        # Footer component
```

## Routes

| Route | Description |
|-------|-------------|
| `/` | Marketing homepage |
| `/about` | About NadaRuns |
| `/drivers` | For Drivers - benefits, signup |
| `/business` | For Business - pricing, features |
| `/contact` | Contact form |
| `/admin` | Admin Dashboard (requires login) |

## Development

```bash
# Install dependencies
yarn install

# Run development server
yarn dev

# Build for production
yarn build

# Start production server
yarn start
```

## Environment Variables

Create a `.env.local` file:

```env
# Backend API URL (required for admin dashboard)
NEXT_PUBLIC_API_URL=https://your-backend-url.com
```

## Admin Login

Default credentials:
- **Email**: admin@nadaruns.com
- **Password**: admin123

## Deployment

### Option 1: Vercel (Recommended)
1. Push to GitHub
2. Connect to Vercel
3. Set environment variables
4. Deploy

### Option 2: Docker
```bash
docker build -t nadaruns-web .
docker run -p 3000:3000 nadaruns-web
```

### Option 3: Static Export
```bash
yarn build
# Deploy the .next/standalone folder
```

## Admin Features

- **Overview**: Platform statistics, revenue, order counts
- **KYC Management**: Approve/reject driver applications
- **Drivers**: View all drivers, online status, ratings

## Marketing Pages

- Modern, responsive design
- Bolt/Uber-inspired aesthetics
- Green (drivers) / Purple (business) color scheme
- Animated hero sections
- Testimonials and pricing
