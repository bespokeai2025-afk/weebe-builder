import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { checkWebuyanyhouseWorkspace } from "@/lib/integrations/webespokeEnterprise/wbah.functions";

/**
 * True when the **active workspace** is Webuyanyhouse — not membership or admin elsewhere.
 */
export function useIsWbahWorkspace() {
  const checkFn = useServerFn(checkWebuyanyhouseWorkspace);
  const [isWbah, setIsWbah] = useState(false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let active = true;
    checkFn()
      .then((res) => {
        if (active) setIsWbah(!!res.isWebuyanyhouse);
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
  }, [checkFn]);

  return { isWbah, resolved };
}
