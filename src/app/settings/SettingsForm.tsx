"use client";

import { useState } from "react";
import { updateProfile } from "@/app/actions";
import { Loader2, Save, ArrowRight } from "lucide-react";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-300">
        {label} <span className="text-slate-500 text-xs font-normal">(Optional)</span>
      </label>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {children}
    </div>
  );
}

const inputCls = "w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-slate-200 focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none text-sm";
const selectCls = inputCls;

export function SettingsForm({ profile, appSettings }: { profile: any; appSettings: any }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const continueRef = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>, continueToUpload = false) => {
    e.preventDefault();
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    if (continueToUpload) formData.set('continueToUpload', '1');
    await updateProfile(formData);
    if (!continueToUpload) {
      setIsSubmitting(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* ── Section: Personal Info ── */}
      <section className="bg-slate-900/50 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-4">
        <h2 className="text-lg font-semibold text-slate-100 border-b border-slate-800 pb-3">👤 Personal Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Birth Year</label>
            <input name="birthYear" type="number" defaultValue={profile.birthYear}
              className={inputCls} placeholder="e.g. 1995" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Target Retirement Age</label>
            <input name="targetRetirementAge" type="number" defaultValue={profile.targetRetirementAge}
              className={inputCls} placeholder="e.g. 65" />
          </div>
          <Field label="Employment Status">
            <select name="employmentStatus" defaultValue={profile.employmentStatus || ""} className={selectCls}>
              <option value="">— Select —</option>
              <option>Employed (Full-Time)</option>
              <option>Employed (Part-Time)</option>
              <option>Self-Employed / Freelance</option>
              <option>Business Owner</option>
              <option>Retired</option>
              <option>Student</option>
              <option>Unemployed</option>
            </select>
          </Field>
          <Field label="Profession">
            <input name="profession" type="text" defaultValue={profile.profession || ""}
              className={inputCls} placeholder="e.g. Software Engineer, Doctor, Contractor" />
          </Field>
          <Field label="Annual Income Range">
            <select name="annualIncomeRange" defaultValue={profile.annualIncomeRange || ""} className={selectCls}>
              <option value="">— Select —</option>
              <option>Under $30k</option>
              <option>$30k–$60k</option>
              <option>$60k–$100k</option>
              <option>$100k–$150k</option>
              <option>$150k–$250k</option>
              <option>$250k–$500k</option>
              <option>Over $500k</option>
            </select>
          </Field>
          <Field label="Job Stability / Income Volatility" hint="How predictable is your income?">
            <select name="jobStabilityVolatility" defaultValue={profile.jobStabilityVolatility || ""} className={selectCls}>
              <option value="">— Select —</option>
              <option>Very Stable (salary, government, tenured)</option>
              <option>Mostly Stable (corporate, some variability)</option>
              <option>Moderately Variable (bonuses, commissions)</option>
              <option>Highly Variable (freelance, sales, gig)</option>
              <option>Irregular (startup equity, seasonal)</option>
            </select>
          </Field>
          <Field label="Emergency Fund" hint="How many months of expenses are covered?">
            <input name="emergencyFundMonths" type="number" step="0.5" defaultValue={profile.emergencyFundMonths || ""}
              className={inputCls} placeholder="e.g. 6" />
          </Field>
        </div>
      </section>

      {/* ── Section: Separate Retirement Assets ── */}
      <section className="bg-slate-900/50 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 border-b border-slate-800 pb-3">🏦 Separate Retirement Assets</h2>
          <p className="text-xs text-slate-500 mt-2">Assets held outside this tracked brokerage account (e.g. 401k, IRA, pension).</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Total Value of Other Retirement Accounts ($)">
            <input name="separateRetirementAssetsAmount" type="number" defaultValue={profile.separateRetirementAssetsAmount || ""}
              className={inputCls} placeholder="e.g. 200000" />
          </Field>
          <Field label="Account Types" hint="e.g. 401k at Fidelity, Roth IRA at Vanguard">
            <input name="separateRetirementAccountsDescription" type="text"
              defaultValue={profile.separateRetirementAccountsDescription || ""}
              className={inputCls} placeholder="e.g. 401k at Fidelity, Roth IRA at Vanguard" />
          </Field>
        </div>
        <Field label="Asset Composition of Retirement Accounts" hint="Describe what your retirement accounts are actually invested in">
          <textarea name="retirementAccountAssetMix" defaultValue={profile.retirementAccountAssetMix || ""}
            rows={3} className={inputCls + " resize-y"}
            placeholder="e.g. 60% broad market ETFs (VTI, VXUS), 25% bond funds (BND), 10% target-date fund, 5% money market" />
        </Field>
      </section>

      {/* ── Section: This Account's Strategy ── */}
      <section className="bg-slate-900/50 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-4">
        <h2 className="text-lg font-semibold text-slate-100 border-b border-slate-800 pb-3">📈 This Account's Strategy</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Investment Objective</label>
            <input name="trackedAccountObjective" type="text" defaultValue={profile.trackedAccountObjective}
              className={inputCls} placeholder="e.g. Aggressive Growth, Dividend Income" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Risk Tolerance</label>
            <select name="trackedAccountRiskTolerance" defaultValue={profile.trackedAccountRiskTolerance} className={selectCls}>
              <option value="low">Low (Capital Preservation)</option>
              <option value="medium">Medium (Balanced)</option>
              <option value="high">High (Maximum Growth)</option>
              <option value="speculative">Speculative (Moonshot)</option>
            </select>
          </div>
          <Field label="Tax Status of This Account">
            <select name="trackedAccountTaxStatus" defaultValue={profile.trackedAccountTaxStatus || ""} className={selectCls}>
              <option value="">— Select —</option>
              <option>Taxable Brokerage</option>
              <option>Roth IRA</option>
              <option>Traditional IRA</option>
              <option>401(k) / 403(b)</option>
              <option>HSA</option>
              <option>529 (Education)</option>
              <option>Custodial / UGMA</option>
            </select>
          </Field>
          <Field label="Investment Style">
            <input name="trackedAccountStyle" type="text" defaultValue={profile.trackedAccountStyle || ""}
              className={inputCls} placeholder="e.g. Growth, Dividend, Momentum, Value" />
          </Field>
          <Field label="Time Horizon">
            <input name="trackedAccountTimeHorizon" type="text" defaultValue={profile.trackedAccountTimeHorizon || ""}
              className={inputCls} placeholder="e.g. 10+ years, 5 years, Short-term" />
          </Field>
          
          <div className="md:col-span-2 mt-2 space-y-2 border-t border-slate-800 pt-4">
            <label className="text-sm font-medium text-slate-300 block mb-1">
              Permitted Asset Classes <span className="text-slate-500 text-xs font-normal">(AI will strictly only recommend these)</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                "Stocks (Individual)",
                "ETFs / Index Funds",
                "Mutual Funds",
                "Bonds / Fixed Income",
                "Cash / Money Market",
                "Real Estate (REITs)",
                "Commodities (Gold/Silver)",
                "Cryptocurrency"
              ].map(asset => {
                const isSelected = (profile.permittedAssetClasses || "").includes(asset);
                return (
                  <label key={asset} className="flex items-start gap-2 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      name="permittedAssetClasses" 
                      value={asset} 
                      defaultChecked={isSelected}
                      className="mt-0.5 rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-600 focus:ring-offset-slate-900"
                    />
                    <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors leading-tight">{asset}</span>
                  </label>
                );
              })}
            </div>
          </div>
          
          <div className="md:col-span-2 border-t border-slate-800 pt-4" />

          <Field label="Leverage / Options Permissions">
            <select name="leverageOptionsPermitted" defaultValue={profile.leverageOptionsPermitted || ""} className={selectCls}>
              <option value="">— Select —</option>
              <option>None (Stocks &amp; ETFs only)</option>
              <option>Options Only (no margin)</option>
              <option>Margin Only</option>
              <option>Margin + Options</option>
              <option>Full (Futures, Spreads, etc.)</option>
            </select>
          </Field>
        </div>
      </section>

      {/* ── Section: Risk & Position Controls ── */}
      <section className="bg-slate-900/50 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-4">
        <h2 className="text-lg font-semibold text-slate-100 border-b border-slate-800 pb-3">⚖️ Risk &amp; Position Controls</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Max Drawdown Tolerance (%)" hint="How much portfolio drop can you stomach before panic selling?">
            <input name="maxDrawdownTolerancePct" type="number" step="1" min="5" max="100"
              defaultValue={profile.maxDrawdownTolerancePct || ""}
              className={inputCls} placeholder="e.g. 30" />
          </Field>
          <Field label="Target Number of Holdings">
            <input name="targetNumberOfHoldings" type="number" min="1" max="100"
              defaultValue={profile.targetNumberOfHoldings || ""}
              className={inputCls} placeholder="e.g. 12" />
          </Field>
          <Field label="Max Single Position Size (%)">
            <input name="maxPositionSizePct" type="number" step="1" min="1" max="100"
              defaultValue={profile.maxPositionSizePct || ""}
              className={inputCls} placeholder="e.g. 15" />
          </Field>
        </div>
      </section>

      {/* ── Section: Sector Preferences ── */}
      <section className="bg-slate-900/50 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-4">
        <h2 className="text-lg font-semibold text-slate-100 border-b border-slate-800 pb-3">🎯 Themes &amp; Sector Preferences</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Sectors / Themes to Emphasize" hint="The AI will actively seek exposure here">
            <textarea name="sectorsToEmphasize" defaultValue={profile.sectorsToEmphasize || ""}
              rows={3} className={inputCls + " resize-y"}
              placeholder="e.g. AI/Technology, Defense, Clean Energy, Healthcare Biotech" />
          </Field>
          <Field label="Sectors / Themes to Avoid" hint="The AI will reduce or exclude these">
            <textarea name="sectorsToAvoid" defaultValue={profile.sectorsToAvoid || ""}
              rows={3} className={inputCls + " resize-y"}
              placeholder="e.g. Tobacco, Gambling, Fossil Fuels, Crypto" />
          </Field>
        </div>
      </section>

      {/* ── Section: Additional Notes ── */}
      <section className="bg-slate-900/50 p-6 sm:p-8 rounded-xl border border-slate-800 space-y-4">
        <h2 className="text-lg font-semibold text-slate-100 border-b border-slate-800 pb-3">📝 Additional Context</h2>
        <Field label="Notes" hint="Anything else the AI should factor in — major life events, liquidity needs, etc.">
          <textarea name="notes" defaultValue={profile.notes || ""}
            rows={4} className={inputCls + " resize-y"}
            placeholder="e.g. Planning to buy a house in 2 years. Expecting a bonus of ~$30k in Q3. Have student loan debt of $45k." />
        </Field>
      </section>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-4">
        <p className="text-xs text-slate-500 text-center sm:text-left">
          Fill in as much or as little as you like — all optional fields can be updated any time.
        </p>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-sm text-green-400 font-medium animate-in fade-in duration-300">✓ Saved</span>
          )}
          <button type="submit" disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-lg text-sm font-semibold transition-all bg-slate-800 text-slate-200 hover:bg-slate-700 active:scale-95 h-11 px-6 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700">
            {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <><Save className="mr-2 h-4 w-4" /> Save Only</>}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={(e) => {
              const form = (e.target as HTMLElement).closest('form') as HTMLFormElement;
              handleSubmit({ preventDefault: () => {}, currentTarget: form } as any, true);
            }}
            className="inline-flex items-center justify-center rounded-lg text-sm font-semibold transition-all bg-blue-600 text-white hover:bg-blue-500 active:scale-95 h-11 px-6 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-900/30">
            {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <>Save &amp; Continue <ArrowRight className="ml-2 h-4 w-4" /></>}
          </button>
        </div>
      </div>
    </form>
  );
}
