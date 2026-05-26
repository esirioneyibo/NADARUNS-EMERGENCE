import Link from "next/link";
import { Bike, Clock, Wallet, Shield, CheckCircle, Star, ArrowRight, Smartphone, Calendar, TrendingUp } from "lucide-react";

export default function DriversPage() {
  return (
    <div className="pt-16">
      {/* Hero */}
      <section className="py-20 bg-gradient-to-br from-emerald-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Bike className="w-4 h-4" />
                Now Hiring Drivers
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                Earn Money on
                <span className="text-emerald-600"> Your Schedule</span>
              </h1>
              <p className="text-xl text-gray-600 mb-8">
                Join thousands of drivers earning great income with flexible hours.
                Be your own boss and deliver when you want.
              </p>
              <Link
                href="#"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all btn-hover"
              >
                <Smartphone className="w-5 h-5" />
                Download the App
              </Link>
              
              {/* Earnings highlight */}
              <div className="mt-12 p-6 bg-white rounded-2xl shadow-lg border border-gray-100">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-emerald-100 rounded-xl flex items-center justify-center">
                    <Wallet className="w-7 h-7 text-emerald-600" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-gray-900">€18-25/hr</div>
                    <div className="text-gray-600">Average driver earnings</div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute -top-10 -right-10 w-64 h-64 bg-emerald-200 rounded-full blur-3xl opacity-30"></div>
              <div className="relative bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-3xl p-8 text-white shadow-2xl">
                <h3 className="text-xl font-bold mb-6">Your Week at a Glance</h3>
                <div className="space-y-4">
                  <div className="bg-white/10 backdrop-blur rounded-xl p-4">
                    <div className="flex justify-between items-center">
                      <span>Monday</span>
                      <span className="font-semibold">€87.50</span>
                    </div>
                    <div className="w-full bg-white/20 rounded-full h-2 mt-2">
                      <div className="bg-white rounded-full h-2 w-3/4"></div>
                    </div>
                  </div>
                  <div className="bg-white/10 backdrop-blur rounded-xl p-4">
                    <div className="flex justify-between items-center">
                      <span>Tuesday</span>
                      <span className="font-semibold">€95.00</span>
                    </div>
                    <div className="w-full bg-white/20 rounded-full h-2 mt-2">
                      <div className="bg-white rounded-full h-2 w-4/5"></div>
                    </div>
                  </div>
                  <div className="bg-white/10 backdrop-blur rounded-xl p-4">
                    <div className="flex justify-between items-center">
                      <span>Wednesday</span>
                      <span className="font-semibold">€72.00</span>
                    </div>
                    <div className="w-full bg-white/20 rounded-full h-2 mt-2">
                      <div className="bg-white rounded-full h-2 w-2/3"></div>
                    </div>
                  </div>
                </div>
                <div className="mt-6 pt-6 border-t border-white/20">
                  <div className="flex justify-between items-center">
                    <span>This week total</span>
                    <span className="text-2xl font-bold">€254.50</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Why Drive with NadaRuns?</h2>
            <p className="text-xl text-gray-600">Benefits that make a difference</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { icon: Clock, title: "Flexible Hours", desc: "Work when you want. No minimum hours, no pressure." },
              { icon: Wallet, title: "Weekly Payouts", desc: "Get paid every Monday directly to your bank account." },
              { icon: Shield, title: "Insurance Coverage", desc: "You're covered while making deliveries." },
              { icon: Smartphone, title: "Easy-to-use App", desc: "Simple navigation, real-time updates, one-tap delivery." },
              { icon: TrendingUp, title: "Earn More with Tips", desc: "Keep 100% of your tips from happy customers." },
              { icon: Star, title: "Rewards Program", desc: "Earn bonuses for consistent high ratings and performance." },
            ].map((benefit, i) => (
              <div key={i} className="p-6 rounded-2xl border border-gray-100 hover:border-emerald-200 hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center mb-4">
                  <benefit.icon className="w-6 h-6 text-emerald-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{benefit.title}</h3>
                <p className="text-gray-600">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">What You Need to Start</h2>
              <p className="text-gray-600 mb-8">
                Getting started is easy. Here's what you need to become a NadaRuns driver.
              </p>
              <div className="space-y-4">
                {[
                  "Be at least 18 years old",
                  "Have a valid driver's license or ID",
                  "Own a bicycle, scooter, motorbike, or car",
                  "Have a smartphone (iOS or Android)",
                  "Pass a simple background check",
                  "Complete KYC verification"
                ].map((req, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <CheckCircle className="w-6 h-6 text-emerald-500 shrink-0" />
                    <span className="text-gray-700">{req}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
              <h3 className="text-2xl font-bold text-gray-900 mb-6">How to Sign Up</h3>
              <div className="space-y-6">
                {[
                  { step: "1", title: "Download the App", desc: "Available on iOS and Android" },
                  { step: "2", title: "Create Account", desc: "Enter your basic information" },
                  { step: "3", title: "Submit Documents", desc: "Upload your ID and vehicle info" },
                  { step: "4", title: "Get Approved", desc: "Usually within 24-48 hours" },
                  { step: "5", title: "Start Earning", desc: "Accept your first delivery!" },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-10 h-10 bg-emerald-600 text-white rounded-full flex items-center justify-center font-bold shrink-0">
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

      {/* Testimonials */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Hear from Our Drivers</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { name: "Mikko L.", earnings: "€850/week", text: "Finally, a platform that respects my time. I set my own hours and earn well." },
              { name: "Aino R.", earnings: "€600/week", text: "Perfect for students! I deliver between classes and make great extra money." },
              { name: "Jussi K.", earnings: "€1,200/week", text: "Full-time driver here. The support team is amazing and payouts are always on time." },
            ].map((testimonial, i) => (
              <div key={i} className="bg-emerald-50 rounded-2xl p-6">
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="w-5 h-5 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-gray-700 mb-4">"{testimonial.text}"</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-400 rounded-full"></div>
                    <span className="font-semibold text-gray-900">{testimonial.name}</span>
                  </div>
                  <div className="text-emerald-600 font-bold">{testimonial.earnings}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-emerald-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-6">Ready to Start Earning?</h2>
          <p className="text-xl text-white/80 mb-8">
            Join our community of drivers today. Sign up takes just 5 minutes.
          </p>
          <Link
            href="#"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-emerald-600 font-semibold rounded-xl hover:bg-gray-100 transition-all btn-hover"
          >
            <Smartphone className="w-5 h-5" />
            Download the App
          </Link>
        </div>
      </section>
    </div>
  );
}
