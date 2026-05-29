import { Target, Heart, Globe, Award, Users, Zap } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="pt-16">
      {/* Hero */}
      <section className="py-20 bg-gradient-to-br from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              About <span className="gradient-text">NadaRuns</span>
            </h1>
            <p className="text-xl text-gray-600">
              We're on a mission to revolutionize delivery in Finland by connecting
              businesses with reliable drivers, creating opportunities for everyone.
            </p>
          </div>
        </div>
      </section>

      {/* Our Story */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">Our Story</h2>
              <div className="space-y-4 text-gray-600">
                <p>
                  NadaRuns was born in Helsinki in 2024 with a simple idea: make delivery
                  faster, more reliable, and more accessible for everyone.
                </p>
                <p>
                  We noticed that businesses struggled to find reliable delivery partners,
                  while many people wanted flexible work opportunities. NadaRuns bridges
                  this gap with technology that connects the right driver with the right
                  delivery, every time.
                </p>
                <p>
                  Today, we're proud to serve thousands of businesses and drivers across
                  Finland, delivering everything from restaurant orders to business packages.
                </p>
              </div>
            </div>
            <div className="relative">
              <div className="absolute -top-10 -right-10 w-64 h-64 bg-emerald-100 rounded-full blur-3xl opacity-50"></div>
              <div className="relative bg-gradient-to-br from-emerald-500 to-indigo-600 rounded-3xl p-8 text-white">
                <h3 className="text-2xl font-bold mb-6">Our Impact</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <div className="text-4xl font-bold">500K+</div>
                    <div className="text-white/70">Deliveries completed</div>
                  </div>
                  <div>
                    <div className="text-4xl font-bold">10K+</div>
                    <div className="text-white/70">Active drivers</div>
                  </div>
                  <div>
                    <div className="text-4xl font-bold">5K+</div>
                    <div className="text-white/70">Business partners</div>
                  </div>
                  <div>
                    <div className="text-4xl font-bold">5</div>
                    <div className="text-white/70">Cities served</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Values</h2>
            <p className="text-xl text-gray-600">What drives us every day</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Target,
                title: "Reliability",
                desc: "Every delivery matters. We ensure your packages arrive on time, every time.",
                bg: "bg-emerald-100",
                text: "text-emerald-600"
              },
              {
                icon: Heart,
                title: "Care",
                desc: "We treat every package as if it were our own, with attention and respect.",
                bg: "bg-rose-100",
                text: "text-rose-600"
              },
              {
                icon: Globe,
                title: "Sustainability",
                desc: "We prioritize eco-friendly delivery options to reduce our carbon footprint.",
                bg: "bg-indigo-100",
                text: "text-indigo-600"
              }
            ].map((value, i) => (
              <div key={i} className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
                <div className={`w-14 h-14 ${value.bg} rounded-xl flex items-center justify-center mb-4`}>
                  <value.icon className={`w-7 h-7 ${value.text}`} />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">{value.title}</h3>
                <p className="text-gray-600">{value.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Leadership Team</h2>
            <p className="text-xl text-gray-600">Meet the people behind NadaRuns</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { name: "Mikko Virtanen", role: "CEO & Founder", bio: "Former logistics executive with 15 years of experience" },
              { name: "Sanna Korhonen", role: "CTO", bio: "Tech leader who built platforms serving millions" },
              { name: "Antti Mäkinen", role: "COO", bio: "Operations expert from global delivery companies" }
            ].map((member, i) => (
              <div key={i} className="text-center">
                <div className="w-32 h-32 bg-gradient-to-br from-emerald-400 to-indigo-400 rounded-full mx-auto mb-4"></div>
                <h3 className="text-xl font-semibold text-gray-900">{member.name}</h3>
                <div className="text-emerald-600 font-medium mb-2">{member.role}</div>
                <p className="text-gray-600 text-sm">{member.bio}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-br from-emerald-600 to-indigo-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-6">Join Our Journey</h2>
          <p className="text-xl text-white/80 mb-8">
            Be part of the delivery revolution in Finland.
          </p>
          <a
            href="/contact"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-emerald-600 font-semibold rounded-xl hover:bg-gray-100 transition-all btn-hover"
          >
            Get in Touch
          </a>
        </div>
      </section>
    </div>
  );
}
