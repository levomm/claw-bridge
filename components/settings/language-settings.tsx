"use client"

import { CheckIcon, LanguagesIcon } from "lucide-react"
import { useLanguage, type AppLanguage } from "@/components/providers/language-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const OPTIONS: Array<{ value: AppLanguage; labelKey: "language.et" | "language.en" }> = [
  { value: "et", labelKey: "language.et" },
  { value: "en", labelKey: "language.en" },
]

export function LanguageSettings() {
  const { language, setLanguage, t } = useLanguage()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><LanguagesIcon className="size-4" />{t("language.title")}</CardTitle>
        <CardDescription>{t("language.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={language === option.value ? "default" : "outline"}
            onClick={() => setLanguage(option.value)}
            className="justify-between"
          >
            {t(option.labelKey)}
            {language === option.value && <CheckIcon className="size-4" />}
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}
