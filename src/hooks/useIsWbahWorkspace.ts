import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { resolveWbahUiAccess } from "@/lib/integrations/webespokeEnterprise/wbah.functions";

/**
 * True when the user should see WBAH-specific UI — platform admin, member of the
 * webuyanyhouse workspace, or currently on that workspace (cookie/default).
 */
export function useIsWbahWorkspace() {
  const resolveFn = useServerFn(resolveWbahUiAccess);
  const [isWbah, setIsWbah] = useState(false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let active = true;
    resolveFn()
      .then((res) => {
        if (active) setIsWbah(!!res.isWbah);
      })
      .catch(() => {
        if (active) setIsWbah(false);
      })
      .finally(() => {
        if (active) setResolved(true);
      });
    return () => {
      active = false;
    };
  }, [resolveFn]);

  return { isWbah, resolved };
}
