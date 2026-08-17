import React from 'react'

const Item = ({language, displayName, selectedLanguage, onClick, editable}) => {

    const className = `element${language === selectedLanguage ? ' element-selected' : ''}`
    return (
        <div className={className} onClick={() => onClick(language)}>
            {displayName} {editable ? '' : '(installed)'}
        </div>
    )
}

export default Item;
