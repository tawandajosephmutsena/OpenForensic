"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  Calculator,
  Check,
  Info,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import type { AuditSettings, Workspace } from "@/lib/types";

interface RulesViewProps {
  workspace: Workspace;
  onApply: (settings: AuditSettings) => void;
}

type NumericField =
  | "baseRate"
  | "marginRate"
  | "taxRate"
  | "taxMinimum"
  | "taxCap"
  | "duplicateWindowDays"
  | "discrepancyTolerance";

type RulesDraft = {
  [Key in NumericField]: string;
} & Pick<AuditSettings, "dayBasis" | "interestMethod" | "taxExemptKeywords">;

type ValidationErrors = Partial<Record<NumericField | "combinedRate", string>>;

function toDraft(settings: AuditSettings): RulesDraft {
  return {
    baseRate: String(settings.baseRate),
    marginRate: String(settings.marginRate),
    dayBasis: settings.dayBasis,
    interestMethod: settings.interestMethod,
    taxRate: String(settings.taxRate),
    taxMinimum: String(settings.taxMinimum),
    taxCap: String(settings.taxCap),
    taxExemptKeywords: settings.taxExemptKeywords,
    duplicateWindowDays: String(settings.duplicateWindowDays),
    discrepancyTolerance: String(settings.discrepancyTolerance),
  };
}

function validate(draft: RulesDraft): { settings: AuditSettings | null; errors: ValidationErrors } {
  const errors: ValidationErrors = {};
  const read = (field: NumericField, minimum: number, maximum: number, integer = false) => {
    const raw = draft[field].trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value)) {
      errors[field] = "Enter a valid number.";
      return 0;
    }
    if (value < minimum || value > maximum) {
      errors[field] = `Use a value between ${minimum} and ${maximum}.`;
    } else if (integer && !Number.isInteger(value)) {
      errors[field] = "Use a whole number of days.";
    }
    return value;
  };

  const baseRate = read("baseRate", 0, 100);
  const marginRate = read("marginRate", -100, 100);
  const taxRate = read("taxRate", 0, 100);
  const taxMinimum = read("taxMinimum", 0, 1_000_000_000_000);
  const taxCap = read("taxCap", 0, 1_000_000_000_000);
  const duplicateWindowDays = read("duplicateWindowDays", 0, 365, true);
  const discrepancyTolerance = read("discrepancyTolerance", 0, 1_000_000_000_000);

  if (!errors.baseRate && !errors.marginRate && (baseRate + marginRate < 0 || baseRate + marginRate > 100)) {
    errors.combinedRate = "Combined annual interest rate must be between 0% and 100%.";
  }

  return {
    settings: Object.keys(errors).length
      ? null
      : {
          baseRate,
          marginRate,
          dayBasis: draft.dayBasis,
          interestMethod: draft.interestMethod,
          taxRate,
          taxMinimum,
          taxCap,
          taxExemptKeywords: draft.taxExemptKeywords,
          duplicateWindowDays,
          discrepancyTolerance,
        },
    errors,
  };
}

function NumberField({
  id,
  label,
  value,
  onChange,
  suffix,
  hint,
  error,
  step = "any",
}: {
  id: NumericField;
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  hint: string;
  error?: string;
  step?: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-[11px] font-medium text-zinc-700">
        {label}
      </label>
      <div className="relative mt-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-description`}
          className={`h-10 w-full rounded-lg border bg-white px-3 text-[12px] font-medium tabular-nums text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 focus:ring-zinc-900/10 ${
            suffix ? "pr-16" : ""
          } ${error ? "border-rose-300 focus:border-rose-400" : "border-zinc-200 focus:border-zinc-400"}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] text-zinc-400">
            {suffix}
          </span>
        )}
      </div>
      <p id={`${id}-description`} className={`mt-1.5 min-h-[15px] text-[10px] leading-relaxed ${error ? "text-rose-600" : "text-zinc-400"}`}>
        {error || hint}
      </p>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof Calculator;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-500">
        <Icon size={16} weight="regular" />
      </span>
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">{eyebrow}</p>
        <h2 className="mt-1 text-[16px] font-medium tracking-tight text-zinc-800">{title}</h2>
        <p className="mt-1 text-[11px] leading-5 text-zinc-500">{description}</p>
      </div>
    </div>
  );
}

export default function RulesView({ workspace, onApply }: RulesViewProps) {
  const [draft, setDraft] = useState<RulesDraft>(() => toDraft(workspace.settings));
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    setDraft(toDraft(workspace.settings));
  }, [workspace.settings]);

  const { settings, errors } = useMemo(() => validate(draft), [draft]);
  const dirty = useMemo(() => {
    if (!settings) return JSON.stringify(draft) !== JSON.stringify(toDraft(workspace.settings));
    return (
      settings.baseRate !== workspace.settings.baseRate ||
      settings.marginRate !== workspace.settings.marginRate ||
      settings.dayBasis !== workspace.settings.dayBasis ||
      settings.interestMethod !== workspace.settings.interestMethod ||
      settings.taxRate !== workspace.settings.taxRate ||
      settings.taxMinimum !== workspace.settings.taxMinimum ||
      settings.taxCap !== workspace.settings.taxCap ||
      settings.taxExemptKeywords !== workspace.settings.taxExemptKeywords ||
      settings.duplicateWindowDays !== workspace.settings.duplicateWindowDays ||
      settings.discrepancyTolerance !== workspace.settings.discrepancyTolerance
    );
  }, [draft, settings, workspace.settings]);

  function updateField<Key extends keyof RulesDraft>(field: Key, value: RulesDraft[Key]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setShowSaved(false);
  }

  function applySettings() {
    if (!settings || (!dirty && workspace.profileConfirmed)) return;
    onApply(settings);
    setShowSaved(true);
  }

  function resetDraft() {
    setDraft(toDraft(workspace.settings));
    setShowSaved(false);
  }

  const combinedRate = Number(draft.baseRate) + Number(draft.marginRate);
  const isValidCombinedRate =
    draft.baseRate.trim() !== "" &&
    draft.marginRate.trim() !== "" &&
    Number.isFinite(combinedRate) &&
    !errors.baseRate &&
    !errors.marginRate &&
    !errors.combinedRate;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-5 pb-16 pt-7 sm:px-8 lg:px-10 lg:pt-9">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-[#E66A30]" />
            Audit workspace <span className="text-zinc-300">/</span> Rules
          </div>
          <h1 className="text-[31px] font-medium tracking-[-0.055em] text-zinc-900 sm:text-[36px]">Audit rules</h1>
          <p className="mt-1.5 max-w-[640px] text-[13px] leading-5 text-zinc-500">
            Configure the assumptions used to screen statement transactions for possible discrepancies.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {dirty && <span className="mr-1 text-[11px] text-[#C95D2C]">Unsaved changes</span>}
          {!workspace.profileConfirmed && workspace.transactions.length > 0 && <span className="mr-1 text-[11px] text-[#C95D2C]">Audit not run</span>}
          {showSaved && !dirty && <span className="mr-1 inline-flex items-center gap-1 text-[11px] text-emerald-700"><Check size={13} /> Applied locally</span>}
          <button
            type="button"
            onClick={resetDraft}
            disabled={!dirty}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 text-[12px] font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowCounterClockwise size={14} /> Reset draft
          </button>
          <button
            type="button"
            onClick={applySettings}
            disabled={(!dirty && workspace.profileConfirmed) || !settings}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-teal px-3.5 text-[12px] font-medium text-white shadow-[0_3px_8px_rgba(24,24,27,0.12)] transition-colors hover:bg-[#076D68] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={14} /> {workspace.profileConfirmed ? "Apply rules" : "Apply & run audit"}
          </button>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-[#F6D7C2] bg-[#FFF8F2] px-4 py-3.5">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#FFE5D3]">
          <ShieldCheck size={13} className="text-[#D45E29]" />
        </span>
        <div className="text-[12px] leading-5 text-[#365F5A]">
          <span className="font-medium">{workspace.isDemo ? "Illustrative demo profile." : workspace.profileConfirmed ? "Workspace screening profile." : "Review this profile before scanning."}</span>{" "}
          These inputs are assumptions, not legal or statutory defaults. Confirm rates, exemptions, thresholds and account terms before relying on any finding.
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)]">
          <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-400">Modeled annual rate</p>
          <p className="mt-4 text-[27px] font-medium tracking-[-0.05em] text-zinc-900">
            {isValidCombinedRate ? `${combinedRate.toFixed(2)}%` : "—"}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">Base rate + margin</p>
        </div>
        <div className="rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)]">
          <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-400">Day convention</p>
          <p className="mt-4 text-[27px] font-medium tracking-[-0.05em] text-zinc-900">{draft.dayBasis}</p>
          <p className="mt-1 text-[11px] text-zinc-400">Days used in annualization</p>
        </div>
        <div className="rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)]">
          <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-400">Interest method</p>
          <p className="mt-4 text-[25px] font-medium capitalize tracking-[-0.05em] text-zinc-900">{draft.interestMethod}</p>
          <p className="mt-1 text-[11px] text-zinc-400">Applied between statement dates</p>
        </div>
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-2">
        <section className="rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)] sm:p-6">
          <SectionHeading
            eyebrow="01 / Interest"
            title="Interest recalculation"
            description="Model daily accrual on negative running balances, then compare it with posted interest charges."
            icon={Calculator}
          />
          <div className="mt-7 grid gap-x-4 gap-y-5 sm:grid-cols-2">
            <NumberField
              id="baseRate"
              label="Base annual rate"
              value={draft.baseRate}
              onChange={(value) => updateField("baseRate", value)}
              suffix="% p.a."
              hint="Benchmark rate supplied for this audit."
              error={errors.baseRate}
            />
            <NumberField
              id="marginRate"
              label="Contract margin"
              value={draft.marginRate}
              onChange={(value) => updateField("marginRate", value)}
              suffix="% p.a."
              hint="Can be negative if your contract requires it."
              error={errors.marginRate}
            />
          </div>
          {errors.combinedRate && <p className="mt-1 text-[10px] text-rose-600">{errors.combinedRate}</p>}
          <div className="mt-5 border-t border-zinc-100 pt-5">
            <p className="text-[11px] font-medium text-zinc-700">Interest method</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["simple", "compound"] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  aria-pressed={draft.interestMethod === method}
                  onClick={() => updateField("interestMethod", method)}
                  className={`rounded-lg border px-3 py-2.5 text-left text-[11px] font-medium capitalize transition-colors ${
                    draft.interestMethod === method
                      ? "border-brand-teal bg-brand-teal text-white"
                      : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400"
                  }`}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5">
            <p className="text-[11px] font-medium text-zinc-700">Annual day basis</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([360, 365] as const).map((basis) => (
                <button
                  key={basis}
                  type="button"
                  aria-pressed={draft.dayBasis === basis}
                  onClick={() => updateField("dayBasis", basis)}
                  className={`rounded-lg border px-3 py-2.5 text-left text-[11px] font-medium transition-colors ${
                    draft.dayBasis === basis
                      ? "border-brand-teal bg-brand-teal text-white"
                      : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400"
                  }`}
                >
                  {basis} days
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)] sm:p-6">
          <SectionHeading
            eyebrow="02 / Transfer tax"
            title="Tax and levy screening"
            description="Compare a linked transfer-tax charge with the configured percentage, threshold, cap and exemptions."
            icon={Calculator}
          />
          <div className="mt-7 grid gap-x-4 gap-y-5 sm:grid-cols-2">
            <NumberField
              id="taxRate"
              label="Tax rate"
              value={draft.taxRate}
              onChange={(value) => updateField("taxRate", value)}
              suffix="%"
              hint="Applied only to linked transfer amounts."
              error={errors.taxRate}
            />
            <NumberField
              id="taxMinimum"
              label="Minimum transfer"
              value={draft.taxMinimum}
              onChange={(value) => updateField("taxMinimum", value)}
              suffix={workspace.currency}
              hint="Below this amount, modeled tax is zero."
              error={errors.taxMinimum}
            />
            <NumberField
              id="taxCap"
              label="Tax cap"
              value={draft.taxCap}
              onChange={(value) => updateField("taxCap", value)}
              suffix={workspace.currency}
              hint="Enter 0 to disable the cap."
              error={errors.taxCap}
            />
          </div>
          <div className="mt-5 border-t border-zinc-100 pt-5">
            <label htmlFor="taxExemptKeywords" className="block text-[11px] font-medium text-zinc-700">
              Exemption keywords
            </label>
            <input
              id="taxExemptKeywords"
              type="text"
              value={draft.taxExemptKeywords}
              onChange={(event) => updateField("taxExemptKeywords", event.target.value)}
              placeholder="Enter verified exemption terms"
              className="mt-2 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[12px] text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10"
            />
            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-400">
              Comma-separated words or phrases matched against the linked transfer description. An empty field applies no exemptions.
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)] sm:p-6">
          <SectionHeading
            eyebrow="03 / Pattern detection"
            title="Duplicates and tolerance"
            description="Control how closely repeated fee entries must align, and the smallest variance worth surfacing."
            icon={WarningCircle}
          />
          <div className="mt-7 grid gap-x-4 gap-y-5 sm:grid-cols-2">
            <NumberField
              id="duplicateWindowDays"
              label="Duplicate window"
              value={draft.duplicateWindowDays}
              onChange={(value) => updateField("duplicateWindowDays", value)}
              suffix="days"
              hint="0 means the same calendar day."
              error={errors.duplicateWindowDays}
              step="1"
            />
            <NumberField
              id="discrepancyTolerance"
              label="Variance tolerance"
              value={draft.discrepancyTolerance}
              onChange={(value) => updateField("discrepancyTolerance", value)}
              suffix={workspace.currency}
              hint="Only larger differences become findings."
              error={errors.discrepancyTolerance}
            />
          </div>
          <div className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50/70 p-3.5 text-[11px] leading-5 text-zinc-500">
            Matching fees need the same amount and normalized description within the selected window. A match is a review signal, not proof of an erroneous charge.
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)] sm:p-6">
          <SectionHeading
            eyebrow="Methodology"
            title="What this screening covers"
            description="Each finding keeps its calculation and original transaction available for review."
            icon={Info}
          />
          <div className="mt-7 divide-y divide-zinc-100">
            <div className="flex gap-3 py-3 first:pt-0">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E66A30]" />
              <p className="text-[11px] leading-5 text-zinc-500"><span className="font-medium text-zinc-700">Interest.</span> Models negative balances between available statement dates using the selected rate and day basis.</p>
            </div>
            <div className="flex gap-3 py-3">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E66A30]" />
              <p className="text-[11px] leading-5 text-zinc-500"><span className="font-medium text-zinc-700">Tax.</span> Links a tax debit to a preceding transfer with the same reference, then applies the configured profile.</p>
            </div>
            <div className="flex gap-3 py-3">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E66A30]" />
              <p className="text-[11px] leading-5 text-zinc-500"><span className="font-medium text-zinc-700">Duplicate fees.</span> Flags matching fee amount and description within the selected day window.</p>
            </div>
            <div className="flex gap-3 py-3 last:pb-0">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E66A30]" />
              <p className="text-[11px] leading-5 text-zinc-500"><span className="font-medium text-zinc-700">Penalties.</span> Flags overdraft-related charges when the reconstructed pre-charge running balance is positive.</p>
            </div>
          </div>
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-[#F6D7C2] bg-[#FFF8F2] p-3.5 text-[10px] leading-[17px] text-[#365F5A]">
            <WarningCircle size={15} className="mt-0.5 shrink-0" />
            <p>Screening can miss value dates, tariff exceptions, rate changes and unavailable transactions. Confirm each finding against the bank agreement and applicable law.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
