#include "postgres.h"
#include "fmgr.h"
#include "catalog/objectaddress.h"
#include "commands/seclabel.h"
#include <string.h>

PG_MODULE_MAGIC;

static void
phase2_dummy_object_relabel(const ObjectAddress *object, const char *label)
{
    (void) object;
    if (label == NULL || strcmp(label, "classified") == 0)
        return;

    ereport(ERROR,
            (errcode(ERRCODE_INVALID_NAME),
             errmsg("invalid synthetic Phase 2 security label")));
}

void
_PG_init(void)
{
    register_label_provider("phase2_dummy", phase2_dummy_object_relabel);
}


/* Disposable transform conversion entry points. They are metadata probes only
 * and are deliberately not invoked by this workflow. */
PG_FUNCTION_INFO_V1(phase2_transform_from_sql);
Datum
phase2_transform_from_sql(PG_FUNCTION_ARGS)
{
    PG_RETURN_NULL();
}

PG_FUNCTION_INFO_V1(phase2_transform_to_sql);
Datum
phase2_transform_to_sql(PG_FUNCTION_ARGS)
{
    PG_RETURN_NULL();
}
