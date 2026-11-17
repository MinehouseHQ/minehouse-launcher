import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { invoke, type HorizonMod } from "@/lib/api"
import { ModIcon, Row } from "@/components/launcher/mods-dialog"

/** Моды, встроенные в Horizon: их нельзя добавить или удалить, только включить или выключить. */
export function HorizonModsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [mods, setMods] = useState<HorizonMod[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setMods(await invoke<HorizonMod[]>("horizon_mods"))
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setError(null)
    load()
  }, [open, load])

  const toggle = async (m: HorizonMod, enabled: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      await invoke("horizon_mods_toggle", { id: m.id, enabled })
      setError(null)
      setMods((prev) => prev?.map((x) => (x.id === m.id ? { ...x, enabled } : x)) ?? null)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(640px,88vh)] w-[min(620px,94vw)] max-w-none flex-col gap-3 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-lg">Моды Horizon</DialogTitle>
          <DialogDescription>
            Они встроены в игру. Выключенный мод не работает со следующего запуска; то же можно сделать в игре:
            Настройки → Моды.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive" className="select-text">
            <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
          </Alert>
        )}
        {mods === null ? (
          <div className="flex flex-1 items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="animate-spin" />
          </div>
        ) : mods.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Список модов появится после первого запуска Horizon.
          </p>
        ) : (
          <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
            {mods.map((m) => (
              <Row key={m.id} dim={!m.enabled}>
                <ModIcon title={m.name} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{m.name}</span>
                  {m.description && <span className="truncate text-xs text-muted-foreground">{m.description}</span>}
                </div>
                <Switch
                  checked={m.enabled}
                  aria-label={m.enabled ? "Выключить" : "Включить"}
                  disabled={busy}
                  onCheckedChange={(enabled) => toggle(m, enabled)}
                />
              </Row>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
