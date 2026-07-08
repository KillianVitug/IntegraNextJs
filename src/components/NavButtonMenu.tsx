import type { LucideIcon } from "lucide-react";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavMenuLinkChoice = {
  title: string;
  href: string;
};

type NavMenuSubmenuChoice = {
  title: string;
  children: NavMenuChoice[];
};

type NavMenuChoice = NavMenuLinkChoice | NavMenuSubmenuChoice;

type Props = {
  icon: LucideIcon;
  label: string;
  choices: NavMenuChoice[];
};

function isSubmenuChoice(choice: NavMenuChoice): choice is NavMenuSubmenuChoice {
  return "children" in choice;
}

function renderMenuChoice(choice: NavMenuChoice) {
  if (isSubmenuChoice(choice)) {
    return (
      <DropdownMenuSub key={choice.title}>
        <DropdownMenuSubTrigger>{choice.title}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {choice.children.map((child) => renderMenuChoice(child))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <DropdownMenuItem key={choice.title} asChild>
      <Link href={choice.href}>{choice.title}</Link>
    </DropdownMenuItem>
  );
}

export function NavButtonMenu({
  icon: Icon,
  label,
  choices,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
        >
          <Icon className="h-4 w-4" />
          <span className="sr-only">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {choices.map((choice) => renderMenuChoice(choice))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
