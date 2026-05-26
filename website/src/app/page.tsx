import Link from "next/link";
import { Zap, Truck, Clock, Shield, Star, ArrowRight, Bike, Building2, CheckCircle, Users, Package, MapPin } from "lucide-react";

export default function Home() {
  return (
    <div className="pt-16">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-gray-50 to-white">
        <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Zap className="w-4 h-4" />
                #1 Delivery Platform in Finland
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight mb-6">
                Fast & Reliable
                <span className="gradient-text"> Delivery</span>
                <br />For Everyone
              </h1>
              <p className="text-xl text-gray-600 mb-8 max-w-lg">
                Connect with professional drivers for quick deliveries or join our fleet to earn money on your own schedule.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href="/drivers"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all btn-hover"
                >
                  <Bike className="w-5 h-5" />
                  Become a Driver
                </Link>
                <Link
                  href="/business"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all btn-hover"
                >
                  <Building2 className="w-5 h-5" />
                  Ship with Us
                </Link>
              </div>
              
              {/* Stats */}
              <div className="grid grid-cols-3 gap-8 mt-12 pt-8 border-t border-gray-200">
                <div>
                  <div className="text-3xl font-bold text-gray-900">10K+</div>
                  <div className="text-gray-600">Active Drivers</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-gray-900">500K+</div>
                  <div className="text-gray-600">Deliveries</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-gray-900">4.9</div>
                  <div className="text-gray-600">App Rating</div>
                </div>
              </div>
            </div>
            
            {/* Hero Image/Illustration */}
            <div className="relative">
              <div className="absolute -top-20 -right-20 w-72 h-72 bg-emerald-200 rounded-full blur-3xl opacity-30"></div>
              <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-indigo-200 rounded-full blur-3xl opacity-30"></div>
              <div className="relative bg-gradient-to-br from-emerald-500 to-indigo-600 rounded-3xl p-8 shadow-2xl">
                <div className="bg-white rounded-2xl p-6 shadow-lg mb-4">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                      <Package className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">Order #A249K</div>
                      <div className="text-sm text-gray-500">In transit</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <MapPin className="w-4 h-4 text-emerald-500" />
                    <span>Karl Fazer Café → Mannerheimintie 15</span>
                  </div>
                </div>
                <div className="bg-white/10 backdrop-blur rounded-xl p-4 text-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                      <Bike className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-medium">Eero V. is delivering</div>
                      <div className="text-sm text-white/70">Arriving in 8 mins</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Why Choose NadaRuns?
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              We're revolutionizing delivery with technology, reliability, and care.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: Clock, title: "Fast Delivery", desc: "Average delivery time under 30 minutes", color: "emerald" },
              { icon: Shield, title: "Secure & Insured", desc: "All deliveries are tracked and insured", color: "indigo" },
              { icon: Star, title: "Top Rated", desc: "4.9 star rating from 100K+ reviews", color: "amber" },
              { icon: Users, title: "24/7 Support", desc: "Round-the-clock customer support", color: "rose" },
            ].map((feature, i) => (
              <div key={i} className="p-6 rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-lg transition-all">
                <div className={`w-14 h-14 bg-${feature.color}-100 rounded-xl flex items-center justify-center mb-4`}>
                  <feature.icon className={`w-7 h-7 text-${feature.color}-600`} />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              How It Works
            </h2>
            <p className="text-xl text-gray-600">
              Getting started is easy, whether you're a driver or a business.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-16">
            {/* For Drivers */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
              <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Bike className="w-4 h-4" />
                For Drivers
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-8">Start earning today</h3>
              <div className="space-y-6">
                {[
                  { step: "1", title: "Sign Up", desc: "Download the app and create your account" },
                  { step: "2", title: "Get Verified", desc: "Complete KYC verification in minutes" },
                  { step: "3", title: "Start Delivering", desc: "Accept orders and earn money" },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-10 h-10 bg-emerald-600 text-white rounded-full flex items-center justify-center font-bold shrink-0">
                      {item.step}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{item.title}</div>
                      <div className="text-gray-600">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/drivers" className="inline-flex items-center gap-2 mt-8 text-emerald-600 font-semibold hover:gap-3 transition-all">
                Learn more <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {/* For Business */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
              <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Building2 className="w-4 h-4" />
                For Business
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-8">Ship with confidence</h3>
              <div className="space-y-6">
                {[
                  { step: "1", title: "Create Account", desc: "Register your business in minutes" },
                  { step: "2", title: "Book Delivery", desc: "Enter pickup and delivery details" },
                  { step: "3", title: "Track & Receive", desc: "Monitor in real-time until delivery" },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold shrink-0">
                      {item.step}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{item.title}</div>
                      <div className="text-gray-600">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/business" className="inline-flex items-center gap-2 mt-8 text-indigo-600 font-semibold hover:gap-3 transition-all">
                Learn more <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Loved by Thousands
            </h2>
            <p className="text-xl text-gray-600">
              See what our drivers and customers are saying.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { name: "Mikko L.", role: "Driver", text: "Best platform for flexible work. I earn well and manage my own schedule.", rating: 5 },
              { name: "Sanna R.", role: "Business Owner", text: "NadaRuns has transformed our delivery operations. Fast and reliable!", rating: 5 },
              { name: "Aino K.", role: "Customer", text: "Always get my orders on time. The tracking feature is amazing.", rating: 5 },
            ].map((testimonial, i) => (
              <div key={i} className="bg-gray-50 rounded-2xl p-6">
                <div className="flex gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, j) => (
                    <Star key={j} className="w-5 h-5 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-gray-700 mb-4">"{testimonial.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-indigo-400 rounded-full"></div>
                  <div>
                    <div className="font-semibold text-gray-900">{testimonial.name}</div>
                    <div className="text-sm text-gray-500">{testimonial.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-br from-emerald-600 to-indigo-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            Ready to Get Started?
          </h2>
          <p className="text-xl text-white/80 mb-8">
            Join thousands of drivers and businesses already using NadaRuns.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/drivers"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-emerald-600 font-semibold rounded-xl hover:bg-gray-100 transition-all btn-hover"
            >
              <Bike className="w-5 h-5" />
              Start Driving
            </Link>
            <Link
              href="/business"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/10 text-white font-semibold rounded-xl hover:bg-white/20 transition-all border border-white/30"
            >
              <Building2 className="w-5 h-5" />
              Ship Products
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
