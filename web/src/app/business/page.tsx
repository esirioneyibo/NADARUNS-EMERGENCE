import Link from "next/link";
import { Building2, Truck, Clock, MapPin, Package, Shield, CheckCircle, ArrowRight, BarChart3, Globe, Zap } from "lucide-react";

export default function BusinessPage() {
  return (
    <div className="pt-16">
      {/* Hero */}
      <section className="py-20 bg-gradient-to-br from-indigo-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Building2 className="w-4 h-4" />
                For Businesses
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                Reliable Delivery
                <span className="text-indigo-600"> For Your Business</span>
              </h1>
              <p className="text-xl text-gray-600 mb-8">
                From small packages to large cargo, we handle your deliveries with
                care and precision. Real-time tracking, competitive pricing, and
                professional drivers.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all btn-hover"
                >
                  Get Started
                </Link>
                <Link
                  href="#pricing"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 border-2 border-indigo-600 text-indigo-600 font-semibold rounded-xl hover:bg-indigo-50 transition-all"
                >
                  View Pricing
                </Link>
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute -top-10 -right-10 w-64 h-64 bg-indigo-200 rounded-full blur-3xl opacity-30"></div>
              <div className="relative bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-3xl p-8 text-white shadow-2xl">
                <h3 className="text-xl font-bold mb-6">Live Shipment Tracking</h3>
                <div className="space-y-4">
                  <div className="bg-white/10 backdrop-blur rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <Package className="w-5 h-5" />
                      <span className="font-medium">Order #SHP-4521</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <MapPin className="w-4 h-4" />
                      <span>En route to delivery • 12 mins away</span>
                    </div>
                  </div>
                  <div className="bg-white/10 backdrop-blur rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <Package className="w-5 h-5" />
                      <span className="font-medium">Order #SHP-4520</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <CheckCircle className="w-4 h-4" />
                      <span>Delivered • 2 hours ago</span>
                    </div>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold">24</div>
                    <div className="text-xs text-white/70">Active</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">156</div>
                    <div className="text-xs text-white/70">This Month</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">99%</div>
                    <div className="text-xs text-white/70">On Time</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Vehicle Types */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Vehicle Options for Every Need</h2>
            <p className="text-xl text-gray-600">Choose the right vehicle for your cargo</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: "🚐", name: "Sprinter Van", capacity: "Up to 1,500 kg", desc: "Small cargo, quick deliveries" },
              { icon: "📦", name: "Box Truck", capacity: "Up to 5,000 kg", desc: "Medium cargo, palletized goods" },
              { icon: "🚚", name: "Flatbed Truck", capacity: "Up to 15,000 kg", desc: "Heavy equipment, materials" },
              { icon: "❄️", name: "Refrigerated", capacity: "Up to 10,000 kg", desc: "Temperature controlled" },
            ].map((vehicle, i) => (
              <div key={i} className="p-6 rounded-2xl border border-gray-100 hover:border-indigo-200 hover:shadow-lg transition-all text-center">
                <div className="text-4xl mb-4">{vehicle.icon}</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{vehicle.name}</h3>
                <div className="text-indigo-600 font-medium text-sm mb-2">{vehicle.capacity}</div>
                <p className="text-gray-600 text-sm">{vehicle.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">Everything You Need</h2>
              <div className="space-y-6">
                {[
                  { icon: MapPin, title: "Real-time Tracking", desc: "Monitor your shipments from pickup to delivery with live GPS tracking." },
                  { icon: Shield, title: "Fully Insured", desc: "All shipments are covered with comprehensive insurance." },
                  { icon: Clock, title: "Same-day Delivery", desc: "Need it there fast? Our drivers can deliver within hours." },
                  { icon: BarChart3, title: "Analytics Dashboard", desc: "Track your shipping history, costs, and performance metrics." },
                ].map((feature, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                      <feature.icon className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">{feature.title}</h3>
                      <p className="text-gray-600">{feature.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
              <h3 className="text-2xl font-bold text-gray-900 mb-6">How It Works</h3>
              <div className="space-y-6">
                {[
                  { step: "1", title: "Create Account", desc: "Register your business in minutes" },
                  { step: "2", title: "Enter Details", desc: "Pickup & delivery addresses, cargo info" },
                  { step: "3", title: "Get Quote", desc: "Instant pricing based on distance & vehicle" },
                  { step: "4", title: "Confirm & Track", desc: "Monitor delivery in real-time" },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold shrink-0">
                      {item.step}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{item.title}</div>
                      <div className="text-gray-600 text-sm">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Simple, Transparent Pricing</h2>
            <p className="text-xl text-gray-600">Pay only for what you use</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { name: "Starter", price: "€1.20", unit: "/km", desc: "Perfect for small businesses", features: ["Sprinter Van access", "Basic tracking", "Email support", "Weekly invoicing"] },
              { name: "Business", price: "€1.80", unit: "/km", desc: "For growing companies", features: ["All vehicle types", "Priority dispatch", "Phone support", "API access"], popular: true },
              { name: "Enterprise", price: "Custom", unit: "", desc: "For large operations", features: ["Volume discounts", "Dedicated account manager", "Custom integrations", "SLA guarantees"] },
            ].map((plan, i) => (
              <div key={i} className={`p-8 rounded-2xl border-2 ${plan.popular ? 'border-indigo-600 bg-indigo-50' : 'border-gray-100 bg-white'} relative`}>
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-4 py-1 rounded-full text-sm font-medium">
                    Most Popular
                  </div>
                )}
                <h3 className="text-xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                  <span className="text-gray-600">{plan.unit}</span>
                </div>
                <p className="text-gray-600 mb-6">{plan.desc}</p>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, j) => (
                    <li key={j} className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-indigo-600" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/contact"
                  className={`block w-full py-3 text-center font-semibold rounded-xl transition-colors ${plan.popular ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50'}`}
                >
                  Get Started
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-indigo-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-6">Ready to Streamline Your Deliveries?</h2>
          <p className="text-xl text-white/80 mb-8">
            Join thousands of businesses already shipping with NadaRuns.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-indigo-600 font-semibold rounded-xl hover:bg-gray-100 transition-all btn-hover"
            >
              Contact Sales
            </Link>
            <Link
              href="/download"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/10 text-white font-semibold rounded-xl hover:bg-white/20 transition-all border border-white/30"
            >
              Download App
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
