import { Settings, Info, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function AccountsMindSettings() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-gray-400" /> AccountsMind Settings
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Configuration for the finance agent</p>
      </div>

      <div className="space-y-4">
        {/* Database notice */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-5 py-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-yellow-300 mb-1">Manual Migration Required</div>
            <p className="text-xs text-yellow-200/70">
              Run <code className="bg-yellow-900/30 px-1 rounded text-yellow-300">ACCOUNTSMIND_MIGRATION.sql</code> in your
              Supabase SQL Editor to create the required tables before using AccountsMind.
            </p>
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 mt-2"
            >
              Open Supabase Dashboard <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Cost engine link */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-sm font-semibold text-white mb-1">Cost Engine</div>
          <p className="text-xs text-gray-400 mb-3">
            AccountsMind reads from the Cost Engine for base provider rates. Configure LLM, voice, and telephony rates in the Cost Engine admin.
          </p>
          <Link
            to="/admin/cost-engine"
            className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
          >
            Open Cost Engine <ExternalLink className="w-3 h-3" />
          </Link>
        </div>

        {/* Alert thresholds */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-sm font-semibold text-white mb-2">Alert Thresholds</div>
          <div className="space-y-2 text-xs text-gray-400">
            <div className="flex justify-between py-1 border-b border-gray-800/50">
              <span>Low margin warning</span>
              <span className="text-yellow-400 font-medium">&lt; 20%</span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-800/50">
              <span>Loss-making (critical)</span>
              <span className="text-red-400 font-medium">&lt; 0%</span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-800/50">
              <span>High video cost alert</span>
              <span className="text-yellow-400 font-medium">&gt; £50/month</span>
            </div>
            <div className="flex justify-between py-1">
              <span>Forecast overrun alert</span>
              <span className="text-yellow-400 font-medium">Cost forecast &gt; charge</span>
            </div>
          </div>
          <p className="text-[10px] text-gray-600 mt-3">
            Thresholds are currently fixed. Custom threshold configuration coming in a future update.
          </p>
        </div>

        {/* Data sources */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-sm font-semibold text-white mb-2">Cost Data Sources</div>
          <div className="grid grid-cols-2 gap-1 text-xs text-gray-400">
            {[
              "call_profitability (voice/LLM/telephony)",
              "provider_usage_log (WhatsApp/email/storage)",
              "growthmind_generation_logs (video/image/AI)",
              "usage_events (base usage)",
              "client_billing_profiles (monthly charge)",
              "cost_engine_* (rate config)",
            ].map((src) => (
              <div key={src} className="flex items-center gap-1.5 py-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                {src}
              </div>
            ))}
          </div>
        </div>

        {/* HiveMind integration */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-sm font-semibold text-white mb-1">HiveMind Integration</div>
          <p className="text-xs text-gray-400">
            AccountsMind reports to HiveMind in Operator mode. Low-margin clients, loss-making accounts, and provider recharge events automatically surface as HiveMind action proposals.
          </p>
        </div>
      </div>
    </div>
  );
}
