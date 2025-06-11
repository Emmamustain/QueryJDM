"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import relationsData from "@/lib/relations_dict.json";

export type Relation = {
  index: number;
  id: number;
  code: string;
  description: string;
  details: string;
};

export function RelationCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[200px] justify-between"
        >
          {value
            ? relationsData.relations.find(
                (relation) => relation.code === value
              )?.code
            : "Select relation..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput placeholder="Search relation..." />
          <CommandList>
            <CommandEmpty>No relation found.</CommandEmpty>
            <CommandGroup>
              {relationsData.relations.map((relation) => (
                <TooltipProvider key={relation.id}>
                  <Tooltip>
                    <TooltipTrigger className="w-full">
                      <CommandItem
                        onSelect={() => {
                          onChange(relation.code);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value === relation.code
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        {relation.code}
                      </CommandItem>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{relation.description}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
