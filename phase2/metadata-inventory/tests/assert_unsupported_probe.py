#!/usr/bin/env python3
"""Require positive discovery of every injected unsupported-object family."""
import json,sys
from pathlib import Path
if len(sys.argv)!=2:raise SystemExit("usage: assert_unsupported_probe.py report.json")
p=json.loads(Path(sys.argv[1]).read_text())
expected={"aggregate","extended_statistics","rule","unsupported_type_family","conversion","user_defined_language","text_search_parser","text_search_template","foreign_table","foreign_data_wrapper","foreign_server","user_mapping","publication","subscription","operator","operator_class","operator_family","event_trigger","collation","text_search_configuration","text_search_dictionary","custom_cast","large_object_metadata","transform","security_label","shared_security_label"}
found={x.get("family") for x in p.get("unsupported_objects",[])}
missing=sorted(expected-found);visibility=p.get("catalogue_visibility_failures",[])
checks={x.get("catalogue_family"):x for x in p.get("catalogue_visibility_checks",[])}
missing_visibility=sorted(x for x in expected if x not in checks or checks[x].get("status")!="PASS" or not checks[x].get("query_executed"))
ok=p.get("status")=="FAIL" and not missing and not visibility and not missing_visibility
print(json.dumps({"status":"PASS" if ok else "FAIL","expected_families":sorted(expected),"detected_families":sorted(expected&found),"missing_families":missing,"visibility_failures":visibility,"missing_visibility_checks":missing_visibility},sort_keys=True))
if not ok:sys.exit(1)
