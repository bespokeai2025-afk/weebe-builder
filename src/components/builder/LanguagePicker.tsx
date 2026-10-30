/** Builder — agent language picker. */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Search, Check, ArrowLeftRight, Globe } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const LANGUAGES: { code: string; flag: string; name: string; region: string }[] = [
  { code: "en-US",  flag: "🇺🇸", name: "English",    region: "US"            },
  { code: "es-ES",  flag: "🇪🇸", name: "Spanish",    region: "Spain"         },
  { code: "es-419", flag: "🇲🇽", name: "Spanish",    region: "Latin America" },
  { code: "en-IN",  flag: "🇮🇳", name: "English",    region: "India"         },
  { code: "en-GB",  flag: "🇬🇧", name: "English",    region: "UK"            },
  { code: "en-AU",  flag: "🇦🇺", name: "English",    region: "Australia"     },
  { code: "en-NZ",  flag: "🇳🇿", name: "English",    region: "New Zealand"   },
  { code: "fr-FR",  flag: "🇫🇷", name: "French",     region: "France"        },
  { code: "fr-CA",  flag: "🇨🇦", name: "French",     region: "Canada"        },
  { code: "zh-CN",  flag: "🇨🇳", name: "Chinese",    region: "China"         },
  { code: "de-DE",  flag: "🇩🇪", name: "German",     region: "Germany"       },
  { code: "hi-IN",  flag: "🇮🇳", name: "Hindi",      region: "India"         },
  { code: "it-IT",  flag: "🇮🇹", name: "Italian",    region: "Italy"         },
  { code: "ja-JP",  flag: "🇯🇵", name: "Japanese",   region: "Japan"         },
  { code: "ko-KR",  flag: "🇰🇷", name: "Korean",     region: "Korea"         },
  { code: "nl-NL",  flag: "🇳🇱", name: "Dutch",      region: "Netherlands"   },
  { code: "pl-PL",  flag: "🇵🇱", name: "Polish",     region: "Poland"        },
  { code: "pt-BR",  flag: "🇧🇷", name: "Portuguese", region: "Brazil"        },
  { code: "pt-PT",  flag: "🇵🇹", name: "Portuguese", region: "Portugal"      },
  { code: "ru-RU",  flag: "🇷🇺", name: "Russian",    region: "Russia"        },
  { code: "tr-TR",  flag: "🇹🇷", name: "Turkish",    region: "Turkey"        },
  { code: "vi-VN",  flag: "🇻🇳", name: "Vietnamese", region: "Vietnam"       },
  { code: "ar-AE",  flag: "🇦🇪", name: "Arabic",     region: "UAE"           },
];

export function langLabel(codes: string[]): string {
  if (!codes.length) return "English (US)";
  if (codes[0] === "multi") return "Flex Mode";
  if (codes.length > 1) return `Multilingual (${codes.length})`;
  const l = LANGUAGES.find((x) => x.code === codes[0]);
  return l ? `${l.flag} ${l.name} (${l.region})` : codes[0];
}

export function LanguagePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [multi, setMulti] = useState(value.length > 1);
  const [search, setSearch] = useState("");

  const isFlex = value.includes("multi");
  const filtered = LANGUAGES.filter(
    (l) =>
      !search ||
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.region.toLowerCase().includes(search.toLowerCase()),
  );

  function toggleLang(code: string) {
    if (multi) {
      if (value.includes(code)) {
        const next = value.filter((c) => c !== code);
        onChange(next.length ? next : [code]);
      } else {
        onChange([...value.filter((c) => c !== "multi"), code]);
      }
    } else {
      onChange([code]);
      setOpen(false);
    }
  }

  function pickFlex() {
    onChange(["multi"]);
    setOpen(false);
  }

  function switchMode() {
    const next = !multi;
    setMulti(next);
    if (!next && value.length > 1) onChange([value[0]]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 w-full justify-between text-xs font-normal px-2">
          <span className="truncate">{langLabel(value)}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="flex items-center justify-between px-3 pt-3 pb-1">
          <span className="text-[11px] font-medium">
            {multi ? "Speech Languages" : "Speech Language"}
          </span>
          <button
            onClick={switchMode}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeftRight className="h-3 w-3" />
            {multi ? "Single-select" : "Multiselect"}
          </button>
        </div>
        {multi && (
          <p className="px-3 pb-1 text-[10px] text-muted-foreground leading-snug">
            Single language mode is recommended for best accuracy.
          </p>
        )}
        <div className="px-2 pb-1">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-6 pr-2 py-1 text-xs bg-muted/40 rounded border-0 outline-none ring-0 placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="max-h-52 overflow-y-auto">
          {filtered.map((l) => {
            const selected = value.includes(l.code);
            return (
              <button
                key={l.code}
                onClick={() => toggleLang(l.code)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors"
              >
                <span className="text-base leading-none w-5 text-center">{l.flag}</span>
                <span className="font-medium">{l.name}</span>
                <span className="text-muted-foreground">({l.region})</span>
                <span className="ml-auto">
                  {multi ? (
                    <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center ${selected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                      {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </span>
                  ) : (
                    selected && <Check className="h-3 w-3 text-primary" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="border-t">
          <button
            onClick={pickFlex}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted/60 transition-colors"
          >
            <Globe className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="font-medium">Flex Mode</span>
            <span className="ml-auto">
              {isFlex && <Check className="h-3 w-3 text-primary" />}
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
