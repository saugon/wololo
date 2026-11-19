export default {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "wololo/v1/run.schema.json",
  "title": "wololo run snapshot (runs/<id>/run.json)",
  "description": "A cache of the run, rebuilt from events.jsonl when missing. Times are seconds since the Unix epoch. A reader derives `orphaned` itself: status not done/failed/cancelled/paused/in_review and owner.heartbeat_at older than 90 seconds.",
  "type": "object",
  "required": [
    "schema_version",
    "id",
    "title",
    "source",
    "project",
    "mode",
    "risk",
    "status",
    "stage",
    "stages",
    "owner",
    "created_at",
    "updated_at"
  ],
  "properties": {
    "schema_version": {
      "const": 1
    },
    "id": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "source": {
      "type": "object",
      "properties": {
        "kind": {
          "enum": [
            "github_issue",
            "text",
            "file"
          ]
        },
        "ref": {
          "type": "string"
        },
        "url": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "project": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string",
          "description": "owner__repo from the origin remote, or local__<name>-<hash>"
        },
        "path": {
          "type": "string"
        },
        "worktree": {
          "type": [
            "string",
            "null"
          ]
        },
        "branch": {
          "type": [
            "string",
            "null"
          ]
        },
        "base": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "mode": {
      "enum": [
        "full",
        "checkpoints",
        "guided"
      ]
    },
    "review": {
      "enum": [
        "local",
        "pr"
      ],
      "description": "Where the change is approved: at the PR gate of the run (local) or on the PR (pr). Missing in runs from before it: local."
    },
    "overrides": {
      "type": "object",
      "description": "Config paths the run's launch flags set, over the project's config."
    },
    "node": {
      "type": "object",
      "description": "The goal node Wololo Desk launched the run from (--node). Missing when the run was started by hand.",
      "required": [
        "goal",
        "id"
      ],
      "properties": {
        "goal": {
          "type": "string"
        },
        "id": {
          "type": "string"
        }
      }
    },
    "adapter_vars": {
      "type": "object",
      "description": "Values the run's adapters captured, for the commands of later steps.",
      "additionalProperties": {
        "type": "string"
      }
    },
    "adapter_job": {
      "type": [
        "object",
        "null"
      ],
      "description": "The adapter step running in the background: its point and index, the command, the job files it writes (job + .out .err .code), its pid, what was known when the point started, and the command that waits for it.",
      "properties": {
        "point": {
          "type": "string"
        },
        "step": {
          "type": "integer"
        },
        "cmd": {
          "type": "string"
        },
        "job": {
          "type": "string"
        },
        "pid": {
          "type": "integer"
        },
        "known": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "wait": {
          "type": "string"
        },
        "since": {
          "type": "number"
        }
      }
    },
    "risk": {
      "enum": [
        "low",
        "high",
        "unknown"
      ]
    },
    "lang": {
      "enum": [
        "es",
        "en"
      ]
    },
    "slot": {
      "type": "integer",
      "description": "Port slot of the run; parallel runs get different slots."
    },
    "instance_used": {
      "description": "The instance the person asked the run to use in place of the work tree's; while set, slot stays on it.",
      "type": [
        "object",
        "null"
      ],
      "required": [
        "slot",
        "reason"
      ],
      "properties": {
        "slot": {
          "type": "integer"
        },
        "reason": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    "status": {
      "enum": [
        "running",
        "waiting_user",
        "waiting_permission",
        "waiting_agents",
        "waiting_ci",
        "waiting_tests",
        "blocked",
        "stalled",
        "pausing",
        "paused",
        "in_review",
        "done",
        "failed",
        "cancelled"
      ]
    },
    "stage": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "id": {
          "enum": [
            "context",
            "definition",
            "gate_a",
            "plan",
            "implement",
            "evidence",
            "gate_b",
            "pr"
          ]
        },
        "index": {
          "type": "integer"
        },
        "total": {
          "type": "integer"
        },
        "since": {
          "type": "number"
        }
      }
    },
    "stages": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "started_at": {
            "type": "number"
          },
          "finished_at": {
            "type": [
              "number",
              "null"
            ]
          }
        }
      }
    },
    "gates": {
      "type": "object",
      "description": "One entry per gate stage (gate_a, gate_b) the run reached.",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "requested_at": {
            "type": "number"
          },
          "resolved_at": {
            "type": [
              "number",
              "null"
            ],
            "description": "Set only by an approval."
          },
          "outcome": {
            "type": [
              "string",
              "null"
            ]
          },
          "by": {
            "type": [
              "string",
              "null"
            ]
          },
          "snapshot": {
            "type": "object",
            "description": "What an approval approved, as hashes of the spec and plan files and of the work tree's committed tree; null where there was none. A later change to any of them needs the gate again.",
            "properties": {
              "spec": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "plan": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "tree": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      }
    },
    "waiting": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "on": {
          "enum": [
            "user",
            "permission"
          ]
        },
        "question": {
          "type": "string"
        },
        "since": {
          "type": "number"
        }
      }
    },
    "blocked": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "reason": {
          "type": "string"
        },
        "since": {
          "type": "number"
        }
      }
    },
    "block_since": {
      "type": [
        "number",
        "null"
      ],
      "description": "When the latest block started, kept after the person's answer lifts it, so that answer can still extend a budget, once."
    },
    "agents": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "role": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "model": {
            "type": [
              "string",
              "null"
            ]
          },
          "status": {
            "type": "string"
          },
          "started_at": {
            "type": "number"
          },
          "finished_at": {
            "type": [
              "number",
              "null"
            ]
          }
        }
      }
    },
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "kind": {
            "enum": [
              "ci",
              "tests",
              "external",
              "server",
              "other"
            ]
          },
          "started_at": {
            "type": "number"
          },
          "finished_at": {
            "type": [
              "number",
              "null"
            ]
          },
          "status": {
            "type": [
              "string",
              "null"
            ]
          },
          "agent": {
            "type": [
              "string",
              "null"
            ],
            "description": "The subagent that started it, when one did; it closes when that agent finishes."
          }
        }
      }
    },
    "items": {
      "type": "object",
      "properties": {
        "done": {
          "type": "integer"
        },
        "total": {
          "type": "integer"
        },
        "current": {
          "type": [
            "object",
            "null"
          ],
          "properties": {
            "n": {
              "type": "integer"
            },
            "title": {
              "type": "string"
            },
            "since": {
              "type": "number"
            }
          }
        },
        "list": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "n": {
                "type": "integer"
              },
              "title": {
                "type": "string"
              },
              "state": {
                "enum": [
                  "pending",
                  "active",
                  "failing",
                  "done"
                ]
              },
              "sha": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "verified": {
                "type": [
                  "object",
                  "null"
                ],
                "description": "When the current attempt last passed verification, and on which tree.",
                "properties": {
                  "at": {
                    "type": "number"
                  },
                  "tree": {
                    "type": [
                      "string",
                      "null"
                    ]
                  }
                }
              },
              "reviewed_at": {
                "type": [
                  "number",
                  "null"
                ],
                "description": "When the current attempt was reviewed after its verification."
              }
            }
          }
        }
      }
    },
    "time": {
      "type": "object",
      "description": "Seconds per stage in each kind of wait (work, agents, tests, you, paused), and seconds each agent role ran in all.",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "work": {
            "type": "number"
          },
          "agents": {
            "type": "number"
          },
          "tests": {
            "type": "number"
          },
          "you": {
            "type": "number"
          },
          "paused": {
            "type": "number"
          },
          "review": {
            "type": "number"
          },
          "roles": {
            "type": "object",
            "additionalProperties": {
              "type": "number"
            }
          }
        }
      }
    },
    "usage": {
      "type": "object",
      "description": "Tokens and US dollars per stage, each split by role (main is the orchestrator).",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "input": {
            "type": "number"
          },
          "output": {
            "type": "number"
          },
          "cache_read": {
            "type": "number"
          },
          "cache_write": {
            "type": "number"
          },
          "usd": {
            "type": "number"
          },
          "roles": {
            "type": "object",
            "additionalProperties": {
              "type": "object",
              "properties": {
                "usd": {
                  "type": "number"
                },
                "tokens": {
                  "type": "number"
                }
              }
            }
          }
        }
      }
    },
    "counts": {
      "type": "object",
      "properties": {
        "assumptions": {
          "type": "integer"
        },
        "decisions": {
          "type": "integer"
        },
        "corrections": {
          "type": "integer"
        },
        "debate_turns": {
          "type": "integer"
        },
        "attempts": {
          "type": "integer"
        },
        "reversals": {
          "type": "integer"
        },
        "nudges": {
          "type": "integer"
        },
        "unsigned": {
          "type": "integer"
        },
        "ci_failures": {
          "type": "integer",
          "description": "CI runs that failed."
        },
        "reversals_by_item": {
          "type": "object",
          "description": "Reversals per item, keyed by the item number.",
          "additionalProperties": {
            "type": "integer"
          }
        },
        "budget_extensions": {
          "type": "object",
          "description": "How many times the person extended each budget by a whole budget more (design_reversals, ci_fix_attempts, run_minutes); runs from before extensions said how much.",
          "additionalProperties": {
            "type": "integer"
          }
        },
        "budget_added": {
          "type": "object",
          "description": "What the person added to each budget, in its unit (minutes for run_minutes).",
          "additionalProperties": {
            "type": "integer"
          }
        }
      }
    },
    "pr": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "url": {
          "type": "string"
        },
        "number": {
          "type": [
            "integer",
            "null"
          ]
        },
        "state": {
          "enum": [
            "draft",
            "ready",
            "merged",
            "closed"
          ]
        },
        "ci": {
          "enum": [
            "pending",
            "passing",
            "failing",
            null
          ]
        }
      }
    },
    "screenshots": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file": {
            "type": "string"
          },
          "caption": {
            "type": "string"
          }
        }
      }
    },
    "owner": {
      "type": "object",
      "properties": {
        "session_id": {
          "type": "string"
        },
        "cwd": {
          "type": "string"
        },
        "heartbeat_at": {
          "type": "number"
        }
      }
    },
    "last_seq": {
      "type": "integer"
    },
    "last_user_at": {
      "type": [
        "number",
        "null"
      ]
    },
    "last_answer_at": {
      "type": [
        "number",
        "null"
      ]
    },
    "last_answer": {
      "type": [
        "object",
        "null"
      ],
      "description": "The last question the person answered, with each header and the option they chose: what a gate is resolved on.",
      "properties": {
        "at": {
          "type": "number"
        },
        "pairs": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "header": {
                "type": "string"
              },
              "answer": {
                "type": "string"
              }
            }
          }
        }
      }
    },
    "created_at": {
      "type": "number"
    },
    "updated_at": {
      "type": "number"
    },
    "finished_at": {
      "type": [
        "number",
        "null"
      ]
    },
    "outcome": {
      "enum": [
        "done",
        "failed",
        "cancelled",
        null
      ]
    },
    "summary": {
      "type": [
        "string",
        "null"
      ]
    },
    "doing": {
      "type": [
        "object",
        "null"
      ],
      "description": "What the run says it is doing now.",
      "properties": {
        "text": {
          "type": "string"
        },
        "since": {
          "type": "number"
        }
      }
    },
    "final_review": {
      "type": [
        "object",
        "null"
      ],
      "description": "The latest review of the whole change by config.review.final's skill, and the committed tree it saw.",
      "properties": {
        "verdict": {
          "enum": [
            "pass",
            "fail"
          ]
        },
        "findings": {
          "type": "integer"
        },
        "tree": {
          "type": [
            "string",
            "null"
          ]
        },
        "at": {
          "type": "number"
        }
      }
    },
    "pause_requested_at": {
      "type": [
        "number",
        "null"
      ]
    },
    "paused": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "note": {
          "type": "string"
        },
        "since": {
          "type": "number"
        }
      }
    },
    "pr_comments": {
      "type": [
        "object",
        "null"
      ],
      "description": "The PR's comments the run was last told about: up to which one (GitHub's ISO time), how many and by whom, and when.",
      "properties": {
        "seen": {
          "type": "string"
        },
        "count": {
          "type": "integer"
        },
        "authors": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "at": {
          "type": "number"
        }
      }
    },
    "pr_review": {
      "type": [
        "object",
        "null"
      ],
      "description": "Since when the PR waits on its reviewers: the run stays open, in review, until the PR merges or the person ends it.",
      "properties": {
        "since": {
          "type": "number"
        }
      }
    }
  }
}
