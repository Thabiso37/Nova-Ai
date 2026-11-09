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
