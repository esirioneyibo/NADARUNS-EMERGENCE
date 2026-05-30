# NadaRuns Website + Admin — VPS Deployment (Node.js + reverse proxy)

The website and admin are ONE Next.js app. It needs Node.js running behind
Apache/nginx as a reverse proxy. Plain static `htdocs` serving will NOT work.

Assumed upload path: `htdocs/nadaruns.com/`
(adjust the absolute path below to match your server, e.g.
`/home/youruser/htdocs/nadaruns.com`)

--------------------------------------------------------------------
## 1. Requirements on the VPS (once)
--------------------------------------------------------------------
- Node.js 20+ and Yarn:  `node -v`  (install via nvm or your distro)
- PM2 (keeps the app running):  `npm install -g pm2`

--------------------------------------------------------------------
## 2. Build the app (inside htdocs/nadaruns.com)
--------------------------------------------------------------------
```bash
cd ~/htdocs/nadaruns.com
yarn install            # creates node_modules/
yarn build              # creates .next/  (the compiled app)
```

--------------------------------------------------------------------
## 3. Create the production .env (inside htdocs/nadaruns.com)
--------------------------------------------------------------------
```
NEXT_PUBLIC_API_URL=https://api.nadaruns.com/api
```
(Point this at your live FastAPI backend, including the /api suffix.)
NOTE: NEXT_PUBLIC_* vars are baked in at build time — re-run `yarn build`
after changing it.

--------------------------------------------------------------------
## 4. Start it with PM2 (port 3000)
--------------------------------------------------------------------
```bash
cd ~/htdocs/nadaruns.com
pm2 start npm --name nadaruns-web -- start    # runs `next start` (port 3000)
pm2 save                                       # remember across reboots
pm2 startup                                    # follow the printed command
```
Change the port if 3000 is taken:  `pm2 start npm --name nadaruns-web -- start -- -p 3001`

--------------------------------------------------------------------
## 5. Reverse proxy
--------------------------------------------------------------------
- Apache: use `deploy/apache-nadaruns.conf` (see that file)
- nginx:  use `deploy/nginx-nadaruns.conf` (see that file)

--------------------------------------------------------------------
## 6. HTTPS (free, recommended)
--------------------------------------------------------------------
```bash
sudo certbot --apache     # or: sudo certbot --nginx
```

--------------------------------------------------------------------
## Updating later
--------------------------------------------------------------------
```bash
cd ~/htdocs/nadaruns.com
# upload changed source files, then:
yarn install              # only if dependencies changed
yarn build
pm2 restart nadaruns-web
```
